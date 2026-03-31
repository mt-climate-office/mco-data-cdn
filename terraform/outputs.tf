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

output "acm_dns_validation_records" {
  description = "DNS records to give your DNS admin for certificate validation"
  value = var.custom_domain != "" ? {
    for dvo in aws_acm_certificate.cdn[0].domain_validation_options : dvo.domain_name => {
      type  = dvo.resource_record_type
      name  = dvo.resource_record_name
      value = dvo.resource_record_value
    }
  } : {}
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
      domain = b.bucket_regional_domain
    }
  ])
}
