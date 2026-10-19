#!/usr/bin/env bash
# Issue a Let's Encrypt certificate for data2.climate.umt.edu and (with
# --import) re-import it into the ACM certificate CloudFront already uses.
#
# Why Let's Encrypt: climate.umt.edu is a CNAME to GitHub Pages, so this name
# inherits GitHub's CAA set (letsencrypt.org, sectigo.com, digicert.com).
# UM's CertiNext portal only issues from emSign, which that CAA set forbids.
# This stays the path until data2 has its own Route 53 zone (see mco-dns).
#
# Validation is HTTP-01. /.well-known/* matches none of the /<origin>/*
# behaviors, so it falls to the default behavior, which serves the storage
# browser bucket as-is. The challenge file goes there and is removed after.
# Let's Encrypt follows the HTTP->HTTPS redirect without checking the cert,
# so this works even after the old cert has expired.
#
# Reuses the existing CSR and key (data2.climate.umt.edu.{csr,key}).
# Output and the ACME account live in letsencrypt/ (gitignored).
#
# Usage: ./scripts/renew-letsencrypt-cert.sh [--import]
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE="${AWS_PROFILE:-mco}"
DOMAIN="data2.climate.umt.edu"
APP_BUCKET="mco-data-cdn-browser-app"
CERT_ARN="arn:aws:acm:us-east-1:202533506375:certificate/002691b8-784f-4dbf-9fc1-d706208e6b62"
LE_DIR="${REPO_ROOT}/letsencrypt"

# certbot calls this script back as its auth and cleanup hooks.
case "${1:-}" in
  --auth-hook)
    printf '%s' "${CERTBOT_VALIDATION}" | aws s3 cp - \
      "s3://${APP_BUCKET}/.well-known/acme-challenge/${CERTBOT_TOKEN}" \
      --profile "${PROFILE}" --content-type text/plain
    exit 0 ;;
  --cleanup-hook)
    aws s3 rm "s3://${APP_BUCKET}/.well-known/acme-challenge/${CERTBOT_TOKEN}" \
      --profile "${PROFILE}"
    exit 0 ;;
esac

DO_IMPORT=false
[[ "${1:-}" == "--import" ]] && DO_IMPORT=true

KEY="${REPO_ROOT}/${DOMAIN}.key"
CSR="${REPO_ROOT}/${DOMAIN}.csr"
STAMP="$(date +%Y%m%d)"
OUT="${LE_DIR}/${STAMP}"
mkdir -p "${OUT}"

echo "=== Checking CSR matches key ==="
[[ "$(openssl req -in "${CSR}" -noout -pubkey | openssl sha256)" == \
   "$(openssl pkey -in "${KEY}" -pubout | openssl sha256)" ]] \
  || { echo "CSR does not match ${KEY}" >&2; exit 1; }

echo "=== Requesting certificate ==="
SELF="${REPO_ROOT}/scripts/$(basename "${BASH_SOURCE[0]}")"
uvx certbot certonly \
  --config-dir "${LE_DIR}/config" \
  --work-dir "${LE_DIR}/work" \
  --logs-dir "${LE_DIR}/logs" \
  --non-interactive --agree-tos --register-unsafely-without-email \
  --manual \
  --manual-auth-hook "${SELF} --auth-hook" \
  --manual-cleanup-hook "${SELF} --cleanup-hook" \
  --preferred-challenges http \
  --csr "${CSR}" \
  --cert-path "${OUT}/cert.pem" \
  --chain-path "${OUT}/chain.pem" \
  --fullchain-path "${OUT}/fullchain.pem"

echo "=== Verifying ==="
openssl x509 -in "${OUT}/cert.pem" -noout -subject -issuer -dates -ext subjectAltName
openssl verify -untrusted "${OUT}/chain.pem" "${OUT}/cert.pem"
[[ "$(openssl x509 -in "${OUT}/cert.pem" -noout -pubkey | openssl sha256)" == \
   "$(openssl pkey -in "${KEY}" -pubout | openssl sha256)" ]] \
  || { echo "Issued cert does not match ${KEY}" >&2; exit 1; }

if ! ${DO_IMPORT}; then
  echo ""
  echo "Issued to ${OUT}. Re-run with --import, or import by hand:"
  echo "  aws acm import-certificate --region us-east-1 --profile ${PROFILE} \\"
  echo "    --certificate-arn ${CERT_ARN} \\"
  echo "    --certificate fileb://${OUT}/cert.pem --private-key fileb://${KEY} \\"
  echo "    --certificate-chain fileb://${OUT}/chain.pem"
  exit 0
fi

echo "=== Importing into ACM ==="
aws acm import-certificate --region us-east-1 --profile "${PROFILE}" \
  --certificate-arn "${CERT_ARN}" \
  --certificate "fileb://${OUT}/cert.pem" \
  --private-key "fileb://${KEY}" \
  --certificate-chain "fileb://${OUT}/chain.pem" \
  --output text --query CertificateArn

echo "=== Done. CloudFront picks up the new cert within a few minutes. ==="
