output "cdn_domain_name" {
  description = "CloudFront distribution domain name"
  value       = aws_cloudfront_distribution.data.domain_name
}

output "cdn_distribution_id" {
  description = "CloudFront distribution ID (for cache invalidation)"
  value       = aws_cloudfront_distribution.data.id
}

output "cdn_origin_urls" {
  description = "CDN URLs for each origin bucket"
  value = {
    for key, _ in var.origin_buckets :
    key => "https://${aws_cloudfront_distribution.data.domain_name}/${key}/"
  }
}

output "cdn_cname_record" {
  description = "CNAME record to point the custom domain to CloudFront"
  value = var.custom_domain != "" ? {
    type  = "CNAME"
    name  = var.custom_domain
    value = aws_cloudfront_distribution.data.domain_name
  } : {}
}

# ---- Storage Browser outputs ------------------------------------------------

output "storage_browser_url" {
  description = "Storage Browser app URL (root of the data CDN)"
  value       = "https://${aws_cloudfront_distribution.data.domain_name}"
}

output "storage_browser_identity_pool_id" {
  description = "Cognito Identity Pool ID for the storage browser"
  value       = aws_cognito_identity_pool.storage_browser.id
}

output "storage_browser_app_bucket" {
  description = "S3 bucket hosting the storage browser app"
  value       = aws_s3_bucket.storage_browser_app.id
}

output "storage_browser_cloudfront_id" {
  description = "CloudFront distribution ID (shared with data CDN)"
  value       = aws_cloudfront_distribution.data.id
}

output "storage_browser_buckets_json" {
  description = "JSON array of bucket configs for the React app"
  value = jsonencode([
    for key, b in var.origin_buckets : {
      label  = key
      bucket = b.bucket_name
      # Where the browser sends ListObjectsV2. Public buckets answer directly
      # (always fresh, and their CORS rule allows this site's origin). A
      # private bucket has no public S3 endpoint, so it is listed through the
      # CDN, which forwards ?list-type=2 to S3 over OAC.
      domain      = b.private ? "${local.cdn_host}/${key}" : b.bucket_regional_domain
      description = b.description
    }
  ])
}

output "storage_browser_cdn_base" {
  description = "Origin the browser builds file links against"
  value       = "https://${local.cdn_host}"
}
