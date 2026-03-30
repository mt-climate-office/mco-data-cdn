# mco-data-cdn

CloudFront CDN infrastructure for Montana Climate Office data S3 buckets.

## Architecture

A single CloudFront distribution fronts multiple S3 origin buckets using path-based routing:

| Path prefix | S3 bucket | Data |
|-------------|-----------|------|
| `/gridmet/*` | `mco-gridmet` | GridMET drought & climate COGs |
| `/snodas/*` | `mco-snodas` | SNODAS SWE COGs & Parquet |

A CloudFront Function strips the path prefix before forwarding to S3, so `/snodas/cogs/file.tif` resolves to `s3://mco-snodas/cogs/file.tif`.

### Features

- **Range request support** — cached by `Range` header for efficient COG access
- **CORS** — open to all origins, exposes `Content-Range`, `Accept-Ranges`, `ETag`
- **HTTP/2 + HTTP/3** — modern transport
- **Compression** — Brotli and gzip

## Setup

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars as needed
terraform init
terraform plan
terraform apply
```

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
