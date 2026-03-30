# =============================================================================
# CloudFront CDN — multi-origin distribution for MCO data buckets
#
# Each origin bucket is mapped to a path prefix: /<key>/*
# Supports range requests and CORS for cloud-optimized geospatial access.
# =============================================================================

# ---- Cache policy: geospatial data (COGs, Parquet, etc.) --------------------
resource "aws_cloudfront_cache_policy" "geospatial" {
  name        = "mco-geospatial-cache-policy"
  comment     = "Cache policy for cloud-optimized geospatial data with range request support"
  default_ttl = var.default_ttl
  max_ttl     = var.max_ttl
  min_ttl     = 0

  parameters_in_cache_key_and_forwarded_to_origin {
    cookies_config {
      cookie_behavior = "none"
    }

    headers_config {
      header_behavior = "whitelist"
      headers {
        items = [
          "Range",
          "Origin",
          "Access-Control-Request-Method",
          "Access-Control-Request-Headers",
        ]
      }
    }

    query_strings_config {
      query_string_behavior = "none"
    }

    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true
  }
}

# ---- Cache policy: volatile data (latest/, etc.) ----------------------------
resource "aws_cloudfront_cache_policy" "volatile" {
  name        = "mco-volatile-cache-policy"
  comment     = "Short-TTL cache policy for frequently-updated data (e.g. latest/)"
  default_ttl = var.volatile_default_ttl
  max_ttl     = var.volatile_max_ttl
  min_ttl     = 0

  parameters_in_cache_key_and_forwarded_to_origin {
    cookies_config {
      cookie_behavior = "none"
    }

    headers_config {
      header_behavior = "whitelist"
      headers {
        items = [
          "Range",
          "Origin",
          "Access-Control-Request-Method",
          "Access-Control-Request-Headers",
        ]
      }
    }

    query_strings_config {
      query_string_behavior = "none"
    }

    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true
  }
}

# ---- Response headers policy: CORS ------------------------------------------
resource "aws_cloudfront_response_headers_policy" "cors" {
  name    = "mco-data-cors-policy"
  comment = "CORS headers for geospatial data access"

  cors_config {
    access_control_allow_credentials = false

    access_control_allow_headers {
      items = ["*"]
    }

    access_control_allow_methods {
      items = ["GET", "HEAD", "OPTIONS"]
    }

    access_control_allow_origins {
      items = ["*"]
    }

    access_control_expose_headers {
      items = [
        "Content-Range",
        "Accept-Ranges",
        "Content-Length",
        "ETag",
      ]
    }

    access_control_max_age_sec = 3600
    origin_override            = true
  }
}

# ---- CloudFront distribution ------------------------------------------------
resource "aws_cloudfront_distribution" "data" {
  comment             = "MCO data CDN"
  enabled             = true
  is_ipv6_enabled     = true
  price_class         = "PriceClass_100" # North America + Europe
  http_version        = "http2and3"
  default_root_object = "index.html"
  # Set aliases only after the ACM cert has been validated and var.enable_custom_domain is true.
  # Step 1: apply with enable_custom_domain = false to create the cert and get DNS records.
  # Step 2: after DNS validation, set enable_custom_domain = true and apply again.
  aliases = var.enable_custom_domain ? [var.custom_domain] : []

  # Create one origin per data bucket
  dynamic "origin" {
    for_each = var.origin_buckets
    content {
      domain_name = origin.value.bucket_regional_domain
      origin_id   = origin.key

      custom_origin_config {
        http_port              = 80
        https_port             = 443
        origin_protocol_policy = "https-only"
        origin_ssl_protocols   = ["TLSv1.2"]
      }
    }
  }

  # Storage browser app origin (serves the React SPA at the root)
  origin {
    domain_name = aws_s3_bucket_website_configuration.storage_browser_app.website_endpoint
    origin_id   = "storage-browser-app"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  # Default cache behavior: serves the storage browser React app
  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "storage-browser-app"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }

    min_ttl     = 0
    default_ttl = 3600
    max_ttl     = 86400
  }

  # SPA routing: serve index.html for unknown paths
  custom_error_response {
    error_code         = 403
    response_code      = 200
    response_page_path = "/index.html"
  }
  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }

  # Volatile paths first (e.g. /gridmet/latest/*, /snodas/latest/*) — short TTL.
  # These MUST come before the general /<key>/* behaviors because CloudFront
  # evaluates ordered_cache_behavior entries in order, most-specific first.
  dynamic "ordered_cache_behavior" {
    for_each = {
      for pair in flatten([
        for origin_key, _ in var.origin_buckets : [
          for vp in var.volatile_path_patterns : {
            key        = "${origin_key}_${vp}"
            origin_key = origin_key
            pattern    = "/${origin_key}/${vp}/*"
          }
        ]
      ]) : pair.key => pair
    }
    content {
      path_pattern           = ordered_cache_behavior.value.pattern
      allowed_methods        = ["GET", "HEAD", "OPTIONS"]
      cached_methods         = ["GET", "HEAD"]
      target_origin_id       = ordered_cache_behavior.value.origin_key
      viewer_protocol_policy = "redirect-to-https"
      compress               = true

      cache_policy_id            = aws_cloudfront_cache_policy.volatile.id
      response_headers_policy_id = aws_cloudfront_response_headers_policy.cors.id

      function_association {
        event_type   = "viewer-request"
        function_arn = aws_cloudfront_function.strip_prefix.arn
      }
    }
  }

  # General path per origin: /<key>/* — long TTL for archival data
  dynamic "ordered_cache_behavior" {
    for_each = var.origin_buckets
    content {
      path_pattern           = "/${ordered_cache_behavior.key}/*"
      allowed_methods        = ["GET", "HEAD", "OPTIONS"]
      cached_methods         = ["GET", "HEAD"]
      target_origin_id       = ordered_cache_behavior.key
      viewer_protocol_policy = "redirect-to-https"
      compress               = true

      cache_policy_id            = aws_cloudfront_cache_policy.geospatial.id
      response_headers_policy_id = aws_cloudfront_response_headers_policy.cors.id

      function_association {
        event_type   = "viewer-request"
        function_arn = aws_cloudfront_function.strip_prefix.arn
      }
    }
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  dynamic "viewer_certificate" {
    for_each = var.enable_custom_domain ? [1] : []
    content {
      acm_certificate_arn      = aws_acm_certificate.cdn[0].arn
      ssl_support_method       = "sni-only"
      minimum_protocol_version = "TLSv1.2_2021"
    }
  }

  dynamic "viewer_certificate" {
    for_each = var.enable_custom_domain ? [] : [1]
    content {
      cloudfront_default_certificate = true
    }
  }

  tags = local.common_tags
}

# ---- CloudFront function: strip path prefix before forwarding to S3 ---------
# CloudFront sends the full URI (e.g. /snodas/cogs/file.tif) to the origin,
# but S3 expects just the object key (cogs/file.tif). This function strips
# the first path segment.
resource "aws_cloudfront_function" "strip_prefix" {
  name    = "mco-strip-origin-prefix"
  runtime = "cloudfront-js-2.0"
  comment = "Strip the first path segment (origin prefix) before forwarding to S3"
  publish = true

  code = <<-JS
    function handler(event) {
      var request = event.request;
      // Remove the first path segment: /snodas/cogs/file.tif -> /cogs/file.tif
      request.uri = request.uri.replace(/^\/[^\/]+/, '');
      return request;
    }
  JS
}
