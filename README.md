# mco-data-cdn

CloudFront CDN infrastructure for Montana Climate Office data S3 buckets, with a built-in web-based file browser.

## Architecture

A single CloudFront distribution fronts multiple S3 origin buckets using path-based routing:

| Path prefix | S3 bucket | Data |
|-------------|-----------|------|
| `/gridmet/*` | `mco-gridmet` | GridMET drought & climate COGs |
| `/snodas/*` | `mco-snodas` | SNODAS SWE COGs & Parquet |
| `/mesonet/*` | `mco-mesonet` | Mesonet Parquet archive, station photos, air quality (private origin, via OAC) |

A CloudFront Function strips the path prefix before forwarding to S3, so `/snodas/cogs/file.tif` resolves to `s3://mco-snodas/cogs/file.tif`. Directory-like paths (no file extension) serve the storage browser SPA instead of hitting S3.

### Data browser

A React SPA served at the CDN root browses every origin bucket. Source is in
`storage-browser/`; `./scripts/deploy-storage-browser.sh` builds it, syncs it to
the app bucket, and invalidates the CDN.

Listings come straight from S3's `ListObjectsV2` REST API — no SDK, no
credentials. Public origin buckets answer directly (their CORS rule allows this
site's origin), so listings are never stale. The private origin has no public S3
endpoint, so it is listed through the CDN, which forwards `?list-type=2` to S3
over OAC. Which endpoint each bucket uses comes from the
`storage_browser_buckets_json` Terraform output.

What it does:

- **Sort** by name, kind, size, or modified time — folders always lead; names
  collate naturally, so `part-2` precedes `part-10`
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

The university's CAA records only allow Sectigo, DigiCert, and Let's Encrypt — not Amazon. Certificates are obtained through InCommon (via Internet2 membership) and manually imported into ACM.

**All three variables must be set together** in `terraform.tfvars`:

```hcl
custom_domain        = "data2.climate.umt.edu"
enable_custom_domain = true
acm_certificate_arn  = "arn:aws:acm:us-east-1:ACCOUNT:certificate/CERT-ID"
```

### Importing/renewing the certificate

```bash
aws acm import-certificate --region us-east-1 --profile mco \
  --certificate-arn <existing-arn> \
  --certificate fileb://data2.climate.umt.edu.crt \
  --private-key fileb://data2.climate.umt.edu.key \
  --certificate-chain fileb://chain.crt
```

For first-time import, omit `--certificate-arn` and update `acm_certificate_arn` in `terraform.tfvars` with the returned ARN.

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

## Cache invalidation

```bash
aws cloudfront create-invalidation \
  --distribution-id $(terraform -chdir=terraform output -raw cdn_distribution_id) \
  --paths "/snodas/latest/*" \
  --profile mco
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
