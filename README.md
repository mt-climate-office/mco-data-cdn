# mco-data-cdn

CloudFront CDN infrastructure for Montana Climate Office data S3 buckets, with a built-in web-based file browser.

## Architecture

A single CloudFront distribution fronts multiple S3 origin buckets using path-based routing:

| Path prefix | S3 bucket | Data |
|-------------|-----------|------|
| `/gridmet/*` | `mco-gridmet` | GridMET drought & climate COGs |
| `/snodas/*` | `mco-snodas` | SNODAS SWE COGs & Parquet |
| `/snotel/*` | `mco-snotel` | SNOTEL daily station data, SWE normals & plots (Parquet, PNG) |
| `/mesonet/*` | `mco-mesonet` | Mesonet Parquet archive, station photos, air quality (private origin, via OAC) |
| `/hhp/*` | `mco-hhp` | Headwaters Hydrology Project datasets (private origin, via OAC) |

A CloudFront Function strips the path prefix before forwarding to S3, so `/snodas/cogs/file.tif` resolves to `s3://mco-snodas/cogs/file.tif`. Directory-like paths (no file extension) serve the storage browser SPA instead of hitting S3.

### Data browser

A React SPA served at the CDN root browses every origin bucket. Source is in
`storage-browser/`; `./scripts/deploy-storage-browser.sh` builds it, syncs it to
the app bucket, and invalidates the CDN.

Listings come straight from S3's `ListObjectsV2` REST API — no SDK, no
credentials. Public origin buckets answer directly (their CORS rule allows this
site's origin), so their listings are never stale. The private origin has no
public S3 endpoint, so it is listed through the CDN, which forwards
`?list-type=2` to S3 over OAC. Those listings *are* cached: an exact-path
behavior on `/<key>/` gives them their own short TTL (`listing_ttl`, default
60 s) instead of the one-day archival TTL, so a new prefix shows up within a
minute. Which endpoint each bucket uses comes from the
`storage_browser_buckets_json` Terraform output.

What it does:

- **Sort** by name, kind, size, or modified time — newest first by default, so
  what just landed is on top; folders always lead; names collate naturally, so
  `part-2` precedes `part-10`
- **Filter** the current folder as you type, or tick **Search subfolders** to
  walk every prefix below it (streaming, with a live count and a Stop button)
- **Preview** in place: Markdown, CSV/TSV as a table, pretty-printed JSON, plain
  text, and images — fetched as a ranged request, so opening a preview of a file
  in a multi-GB tree costs 512 KB
- **README rendering** — a folder's `README.md` renders under its listing
- **Copy links** per file or for a whole folder, as an HTTPS URL, an `s3://`
  URI, or a GDAL `/vsicurl/` path; save a folder's URLs as `urls.txt`
- **List or grid view**, virtualized — the SNODAS COG tree lists 8,000+ dated
  folders without dropping a frame
- **Linkable state** — the folder is the URL path; filter, sort, view mode, and
  subfolder search ride in the query string
- **Keyboard driven** — `/` to filter, `j`/`k` to move, `Enter` to open, `u` to
  go up, `v` for view, `r` for recursive, `?` for the full list
- Light and dark themes, and a layout that works down to phone width

#### Local development

```bash
cd storage-browser
npm install
npm run dev
```

The buckets' CORS rules only allow the production hosts, so `vite dev` proxies
listings through `/__s3/<bucket>` (see `vite.config.js`); file links point at
`VITE_CDN_BASE`. Both come from `.env`, which the deploy script regenerates from
Terraform outputs.

### CDN features

- **Range request support** — cached by `Range` header for efficient COG access
- **CORS** — open to all origins, exposes `Content-Range`, `Accept-Ranges`, `ETag`
- **HTTP/2 + HTTP/3** — modern transport
- **Compression** — Brotli and gzip
- **Tiered caching** — short TTL for volatile paths (e.g. `latest/`), long TTL for archival data
- **Per-origin cache keys** — the prefix-stripping CloudFront function runs
  before the cache lookup, so `/gridmet/raw/x` and `/snodas/raw/x` both become
  `/raw/x`. The cache key covers the distribution and URI but not the cache
  behavior or origin, so the function stamps an `x-mco-origin` header that both
  cache policies include in the key. Without it, two buckets sharing a key path
  share one cached object.

## Setup

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars — set origin_buckets at minimum
terraform init
terraform plan
terraform apply
```

## Custom domain and SSL certificate

`climate.umt.edu` is a CNAME to GitHub Pages, so `data2` inherits GitHub's CAA
records: Let's Encrypt, Sectigo and DigiCert only. That rules out ACM-issued
certificates (`amazon.com`) and UM's CertiNext portal, which issues only from
emSign (`emsign.com`). The certificate is therefore a **Let's Encrypt** cert
imported into ACM.

**All three variables must be set together** in `terraform.tfvars`:

```hcl
custom_domain        = "data2.climate.umt.edu"
enable_custom_domain = true
acm_certificate_arn  = "arn:aws:acm:us-east-1:ACCOUNT:certificate/CERT-ID"
```

### Automatic renewal

ACM never renews imported certificates, so `terraform/cert-renewal.tf` deploys a
Lambda, `mco-data-cdn-cert-renewer` in us-east-1 (source in `cert-renewer/`). It
runs daily at 15:00 UTC. Once the certificate has fewer than `cert_renew_days`
(default 30) days left, it does the following:

- generates a fresh key (only ACM keeps a copy)
- orders a certificate over ACME HTTP-01
- re-imports the certificate into the same ARN, so CloudFront picks it up
  without a Terraform change

Challenge files go in the storage browser bucket under
`.well-known/acme-challenge/`. That path matches no `/<origin>/*` behavior, so
the default behavior serves it. The ACME account key is the SSM SecureString
`/mco-data-cdn/acme-account-key`.

Two alarms email `cert_alert_email`. The first fires when the Lambda errors.
The second is independent of the Lambda and fires when ACM's `DaysToExpiry`
for the certificate drops below 14. Confirm the SNS subscription email once,
after the first apply.

`scripts/build-cert-renewer.sh` builds the Lambda package. Terraform runs it on
every plan, so it requires `uv`.

To test the deployed function without changing the live certificate, run a
forced dry run. It issues a real certificate but does not import it:

```bash
aws lambda invoke --region us-east-1 --profile mco \
  --function-name mco-data-cdn-cert-renewer \
  --cli-binary-format raw-in-base64-out \
  --payload '{"force": true, "dry_run": true}' /dev/stdout
```

Use `{"force": true}` to renew now. Let's Encrypt allows 5 identical
certificates per week.

**Manual fallback:** `./scripts/renew-letsencrypt-cert.sh --import` does the
same job from a laptop with the repo's `data2.climate.umt.edu.{csr,key}`.

**Retiring this:** once `data2` has its own Route 53 zone (see the `mco-dns`
repo) with a CAA record allowing `amazon.com`, switch to an ACM-issued
certificate, which renews itself, and delete the renewer.

### DNS

Point the custom domain to CloudFront with a CNAME record. The required value is shown in `terraform output cdn_cname_record`.

## Adding a new origin bucket

Add an entry to `origin_buckets` in `terraform.tfvars`:

```hcl
origin_buckets = {
  gridmet = { ... }
  snodas  = { ... }
  newdata = {
    bucket_name            = "mco-newdata"
    bucket_regional_domain = "mco-newdata.s3.us-west-2.amazonaws.com"
  }
}
```

Then `terraform apply`. A new path prefix `/newdata/*` will be created automatically.

## Access logs

Standard logging (v2) delivers every request to the private bucket
`mco-data-cdn-access-logs` as gzipped W3C files under
`AWSLogs/<account>/CloudFront/<DistributionId>/<yyyy>/<MM>/<dd>/<HH>/`, a few
minutes behind real time. Standard-IA at 30 days, expired at
`access_log_retention_days` (365). Logs carry client IPs; the bucket has no
CDN path. Defined in `terraform/logging.tf` (delivery source in us-east-1, as
CloudFront requires). Enabled 2026-10-04 — nothing earlier was logged.

```zsh
aws s3 cp s3://mco-data-cdn-access-logs/AWSLogs/ . --recursive --profile mco
```

## Cache invalidation

**Invalidation paths are CACHE KEYS, not public URLs — drop the origin prefix.**

`mco-strip-origin-prefix` is a **viewer-request** function, and a viewer-request
rewrite runs *before* the cache lookup. So the object published at
`data2.climate.umt.edu/snodas/latest/x.tif` is cached under `/latest/x.tif`,
and that is what an invalidation is matched against.

Getting this wrong **fails silently**: a wildcard that matches zero objects is
still a successful invalidation, so CloudFront reports `Completed` and nothing
is flushed. With `DefaultTTL` at 3600 s the stale copy ages out within the hour,
so the mistake is invisible unless something re-publishes the same path twice in
one hour. That is exactly how it bit the Mesonet living archive
([mesonet-db-rds#167](https://github.com/mt-climate-office/mesonet-db-rds/issues/167)):
a same-day repair served the superseded file through two "successful"
invalidations.

```bash
# Public URL:  data2.climate.umt.edu/snodas/latest/x.tif
# Cache key:                        /latest/x.tif   <-- invalidate THIS
aws cloudfront create-invalidation \
  --distribution-id $(terraform -chdir=terraform output -raw cdn_distribution_id) \
  --paths "/latest/*" \
  --profile mco
```

Two caveats that follow from the strip:

- A cache key is **shared across origins**. `/latest/*` above also matches
  gridmet's and mesonet's `latest/` trees. The function puts the origin in an
  `x-mco-origin` header that the cache policy includes, so the *entries* stay
  distinct — but an invalidation path cannot see that header, so it flushes all
  of them. Harmless, just broader than it looks.
- `--paths "/*"` is always correct (it matches every key regardless of
  rewriting), which is why the storage-browser deploy below needs no special
  care.

To verify a bust actually worked, compare the CDN against S3 rather than
trusting the `Completed` status:

```bash
aws s3api head-object --bucket mco-snodas --key latest/x.tif \
  --profile mco --query '[ContentLength,LastModified]'
curl -sI https://data2.climate.umt.edu/snodas/latest/x.tif \
  | grep -i 'content-length\|last-modified\|x-cache'
```

## Deploying the storage browser

```bash
cd storage-browser
npm ci && npm run build
aws s3 sync dist/ s3://mco-data-cdn-browser-app --delete --profile mco
aws cloudfront create-invalidation \
  --distribution-id $(terraform -chdir=../terraform output -raw cdn_distribution_id) \
  --paths "/*" \
  --profile mco
```
