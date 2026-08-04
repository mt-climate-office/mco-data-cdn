# mco-data-cdn

CloudFront CDN infrastructure for Montana Climate Office data S3 buckets, with a built-in web-based file browser.

## Architecture

A single CloudFront distribution fronts multiple S3 origin buckets using path-based routing:

| Path prefix | S3 bucket | Data |
|-------------|-----------|------|
| `/gridmet/*` | `mco-gridmet` | GridMET drought & climate COGs |
| `/snodas/*` | `mco-snodas` | SNODAS SWE COGs & Parquet |

A CloudFront Function strips the path prefix before forwarding to S3, so `/snodas/cogs/file.tif` resolves to `s3://mco-snodas/cogs/file.tif`. Directory-like paths (no file extension) serve the storage browser SPA instead of hitting S3.

### Storage browser

A React SPA served at the CDN root provides a web-based file browser for all origin buckets. It uses a Cognito Identity Pool for unauthenticated guest access to S3 `ListBucket`/`GetObject`. Source is in `storage-browser/`.

### Features

- **Range request support** — cached by `Range` header for efficient COG access
- **CORS** — open to all origins, exposes `Content-Range`, `Accept-Ranges`, `ETag`
- **HTTP/2 + HTTP/3** — modern transport
- **Compression** — Brotli and gzip
- **Tiered caching** — short TTL for volatile paths (e.g. `latest/`), long TTL for archival data

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
