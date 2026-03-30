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
  description = "Map of path prefix to S3 bucket name for each origin"
  type = map(object({
    bucket_name            = string
    bucket_regional_domain = string
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

variable "custom_domain" {
  description = "Custom domain name for the CDN (e.g. data2.climate.umt.edu)"
  type        = string
  default     = ""
}

variable "enable_custom_domain" {
  description = "Attach custom domain to CloudFront. Set to true only after ACM cert is validated."
  type        = bool
  default     = false
}
