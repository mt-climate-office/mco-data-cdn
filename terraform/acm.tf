# =============================================================================
# ACM certificate for custom domain — must be in us-east-1 for CloudFront
# =============================================================================

resource "aws_acm_certificate" "cdn" {
  count    = var.custom_domain != "" ? 1 : 0
  provider = aws.us_east_1

  domain_name       = var.custom_domain
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = local.common_tags
}
