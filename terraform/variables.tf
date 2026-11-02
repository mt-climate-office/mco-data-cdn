variable "aws_region" {
  description = "AWS region for the S3 origin buckets"
  type        = string
  default     = "us-west-2"
}

variable "aws_profile" {
  description = "AWS CLI profile"
  type        = string
  default     = "mco"
}

variable "origin_buckets" {
  description = <<-EOT
    Map of path prefix to S3 bucket for each origin. `private = true` serves
    the bucket through Origin Access Control (signed S3 origin) instead of an
    unauthenticated custom origin — required for buckets with a public-access
    block (e.g. mco-mesonet). The bucket's own policy must then allow this
    distribution's ARN (managed wherever that bucket's policy lives).
  EOT
  type = map(object({
    bucket_name            = string
    bucket_regional_domain = string
    private                = optional(bool, false)
    description            = optional(string, "")
  }))
}

variable "default_ttl" {
  description = "Default cache TTL in seconds for archival (date-stamped) data"
  type        = number
  default     = 86400 # 1 day
}

variable "max_ttl" {
  description = "Maximum cache TTL in seconds for archival data"
  type        = number
  default     = 604800 # 7 days
}

variable "volatile_default_ttl" {
  description = "Default cache TTL in seconds for frequently-updated paths (e.g. latest/)"
  type        = number
  default     = 3600 # 1 hour
}

variable "volatile_max_ttl" {
  description = "Maximum cache TTL in seconds for frequently-updated paths"
  type        = number
  default     = 21600 # 6 hours
}

variable "volatile_path_patterns" {
  description = "Path suffixes (within each origin prefix) that contain frequently-updated data"
  type        = list(string)
  default     = ["latest"]
}

variable "volatile_exact_paths" {
  description = <<-EOT
    Exact distribution paths that are rewritten frequently and must not inherit
    the archival TTL — e.g. a manifest regenerated many times a day. Each gets
    the short-TTL volatile cache policy.

    Unlike volatile_path_patterns (which are suffixes applied within every
    origin prefix), these are full paths and must include the leading
    /<origin_key>/ prefix.
  EOT
  type        = list(string)
  default     = []
}

variable "volatile_layout_paths" {
  description = <<-EOT
    Full distribution path patterns (wildcards allowed, leading /<origin_key>/
    required) for trees that are rewritten in place daily, so they get the
    short-TTL volatile cache policy instead of the archival one.

    Unlike volatile_exact_paths, which lives in each deployment's tfvars, this
    list describes the snow buckets' published layout, so its default is
    committed here. Patterns whose origin key is not in origin_buckets are
    skipped.

    The default covers layout v1 of mco-snodas and mco-snotel (mco-snotel
    docs/bucket-layout.md): the latest/ trees, the current-season tables that
    are overwritten each day, the SNOTEL station table, and the SNOTEL raw
    archive split by water year (the current year's file is rewritten
    nightly; past years are small and rarely read, so one wildcard is cheaper
    than a behavior that must be edited every October). Dated trees (raw COGs,
    normals, plots, daily percentile grids) are immutable and keep the
    archival TTL. Each entry is one cache behavior; the account's CloudFront
    quota is 75 per distribution.
  EOT
  type        = list(string)
  default = [
    "/snodas/gridded/daily/latest/*",
    "/snodas/zonal/daily/latest/*",
    "/snodas/zonal/daily/means/*",
    "/snodas/zonal/daily/percentiles/*",
    "/snotel/daily/latest/*",
    "/snotel/daily/percentiles/*",
    "/snotel/raw/*",
    "/snotel/stations.parquet",
  ]
}

variable "listing_ttl" {
  description = <<-EOT
    Cache TTL in seconds for S3 ListObjectsV2 responses served through the CDN
    (private origins only). Short, so a new prefix appears in the data browser
    almost immediately, but non-zero so a recursive walk of a large tree does
    not hammer S3.
  EOT
  type        = number
  default     = 60
}

variable "custom_domain" {
  description = "Custom domain name for the CDN (e.g. data2.climate.umt.edu)"
  type        = string
  default     = ""
}

variable "enable_custom_domain" {
  description = "Attach custom domain and ACM certificate to CloudFront. Requires acm_certificate_arn."
  type        = bool
  default     = false
}

variable "acm_certificate_arn" {
  description = "ARN of the ACM certificate for the custom domain. An imported certificate, kept current by the cert-renewer Lambda (cert-renewal.tf)."
  type        = string
  default     = ""
}

variable "access_log_bucket" {
  description = "Private bucket receiving the distribution's standard (v2) access logs."
  type        = string
  default     = "mco-data-cdn-access-logs"
}

variable "access_log_retention_days" {
  description = "Days to keep CloudFront access logs before expiry."
  type        = number
  default     = 365
}

variable "cert_alert_email" {
  description = "Email for certificate renewal failures and near-expiry alerts (SNS; confirm the subscription email once)."
  type        = string
}

variable "cert_renew_days" {
  description = "Renew the certificate once it has fewer than this many days left."
  type        = number
  default     = 30
}
