"""Renew the CDN's Let's Encrypt certificate and re-import it into ACM.

Runs daily. Does nothing until the ACM certificate is within RENEW_DAYS of
expiry, then:

1. generates a fresh RSA key and CSR (ACM keeps the key; nothing else does),
2. orders a certificate over ACME HTTP-01, writing each challenge response to
   the storage browser bucket. /.well-known/* matches no /<origin>/* behavior,
   so CloudFront serves it from that bucket via the default behavior,
3. re-imports the certificate into the same ACM ARN, which CloudFront uses.

The ACME account key lives in an SSM SecureString, created on first run.

Why Let's Encrypt and not ACM-issued or InCommon: climate.umt.edu is a CNAME
to GitHub Pages, so this name inherits GitHub's CAA set, which allows
letsencrypt.org but not amazon.com or emsign.com (UM's CertiNext CA).
"""

import datetime as dt
import json
import logging
import os

import boto3
import josepy as jose
from acme import challenges, client, crypto_util, errors, messages
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

log = logging.getLogger()
log.setLevel(logging.INFO)

DOMAIN = os.environ["DOMAIN"]
CERT_ARN = os.environ["CERT_ARN"]
CHALLENGE_BUCKET = os.environ["CHALLENGE_BUCKET"]
ACCOUNT_KEY_PARAM = os.environ["ACCOUNT_KEY_PARAM"]
DIRECTORY_URL = os.environ.get(
    "DIRECTORY_URL", "https://acme-v02.api.letsencrypt.org/directory"
)
RENEW_DAYS = int(os.environ.get("RENEW_DAYS", "30"))

ACM_REGION = CERT_ARN.split(":")[3]
acm = boto3.client("acm", region_name=ACM_REGION)
s3 = boto3.client("s3")
ssm = boto3.client("ssm")


def _rsa_key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def _pem(key):
    return key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.TraditionalOpenSSL,
        serialization.NoEncryption(),
    )


def _account_key():
    try:
        pem = ssm.get_parameter(Name=ACCOUNT_KEY_PARAM, WithDecryption=True)[
            "Parameter"
        ]["Value"]
        key = serialization.load_pem_private_key(pem.encode(), password=None)
    except ssm.exceptions.ParameterNotFound:
        key = _rsa_key()
        ssm.put_parameter(
            Name=ACCOUNT_KEY_PARAM,
            Value=_pem(key).decode(),
            Type="SecureString",
        )
        log.info("Created ACME account key in %s", ACCOUNT_KEY_PARAM)
    return jose.JWKRSA(key=key)


def _acme_client(account_key):
    net = client.ClientNetwork(account_key, user_agent="mco-data-cdn-cert-renewer")
    directory = client.ClientV2.get_directory(DIRECTORY_URL, net)
    acme = client.ClientV2(directory, net=net)
    reg = messages.NewRegistration.from_data(terms_of_service_agreed=True)
    try:
        acme.new_account(reg)
    except errors.ConflictError as e:
        # The key is already registered; bind the client to that account.
        net.account = messages.RegistrationResource(
            uri=e.location, body=messages.Registration()
        )
    return acme


def days_left():
    cert = acm.describe_certificate(CertificateArn=CERT_ARN)["Certificate"]
    remaining = cert["NotAfter"] - dt.datetime.now(dt.timezone.utc)
    return remaining.total_seconds() / 86400


def issue():
    """Order a certificate. Returns (cert_pem, chain_pem, key_pem)."""
    account_key = _account_key()
    acme = _acme_client(account_key)

    key_pem = _pem(_rsa_key())
    order = acme.new_order(crypto_util.make_csr(key_pem, [DOMAIN]))

    written = []
    try:
        for authz in order.authorizations:
            if authz.body.status == messages.STATUS_VALID:
                continue
            chall = next(
                c for c in authz.body.challenges if isinstance(c.chall, challenges.HTTP01)
            )
            response, validation = chall.response_and_validation(account_key)
            object_key = chall.chall.path.lstrip("/")
            s3.put_object(
                Bucket=CHALLENGE_BUCKET,
                Key=object_key,
                Body=validation.encode(),
                ContentType="text/plain",
            )
            written.append(object_key)
            acme.answer_challenge(chall, response)

        deadline = dt.datetime.now() + dt.timedelta(seconds=90)
        order = acme.poll_and_finalize(order, deadline)
    finally:
        for object_key in written:
            s3.delete_object(Bucket=CHALLENGE_BUCKET, Key=object_key)

    # fullchain_pem is the leaf followed by the intermediates.
    marker = "-----END CERTIFICATE-----\n"
    leaf, _, chain = order.fullchain_pem.partition(marker)
    return (leaf + marker).encode(), chain.strip().encode(), key_pem


def handler(event, context):
    event = event or {}
    remaining = days_left()
    log.info("%s: %.1f days left on %s", DOMAIN, remaining, CERT_ARN)
    if remaining > RENEW_DAYS and not event.get("force"):
        return {"renewed": False, "days_left": round(remaining, 1)}

    cert_pem, chain_pem, key_pem = issue()
    if event.get("dry_run"):
        log.info("Dry run: issued but not imported")
        return {"renewed": False, "dry_run": True, "cert": cert_pem.decode()}

    acm.import_certificate(
        CertificateArn=CERT_ARN,
        Certificate=cert_pem,
        PrivateKey=key_pem,
        CertificateChain=chain_pem,
    )
    remaining = days_left()
    log.info("Imported; %.1f days left", remaining)
    return {"renewed": True, "days_left": round(remaining, 1)}


if __name__ == "__main__":
    print(json.dumps(handler({"force": True, "dry_run": True}, None), indent=2))
