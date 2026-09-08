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
          # Set by the strip_prefix function to the origin's path prefix. That
          # function rewrites the URI *before* the cache lookup, so /gridmet/x
          # and /snodas/x both become /x and would otherwise share one cache
          # entry across two buckets — the cache key covers the distribution
          # and URI, not the cache behavior or origin. This header keeps the
          # origins apart.
          "x-mco-origin",
        ]
      }
    }

    query_strings_config {
      query_string_behavior = "whitelist"
      query_strings {
        # list-type/prefix/delimiter/continuation-token: S3 REST listing
        # through the CDN. versionId: time-travel GETs against the Mesonet
        # living archive's tag manifests — it must be BOTH forwarded (S3
        # serves the pinned version) and in the cache key (a versioned and a
        # current read of the same path must never share a cache entry).
        items = ["list-type", "prefix", "delimiter", "continuation-token", "versionId"]
      }
    }

    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true
  }
}

# ---- Origin Access Control for private S3 origins ---------------------------
resource "aws_cloudfront_origin_access_control" "private_s3" {
  name                              = "mco-data-cdn-private-s3"
  description                       = "Signs origin requests to private origin buckets (public-access-block on)"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
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
          # Set by the strip_prefix function to the origin's path prefix. That
          # function rewrites the URI *before* the cache lookup, so /gridmet/x
          # and /snodas/x both become /x and would otherwise share one cache
          # entry across two buckets — the cache key covers the distribution
          # and URI, not the cache behavior or origin. This header keeps the
          # origins apart.
          "x-mco-origin",
        ]
      }
    }

    query_strings_config {
      query_string_behavior = "whitelist"
      query_strings {
        items = ["list-type", "prefix", "delimiter", "continuation-token"]
      }
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
  comment         = "MCO data CDN"
  enabled         = true
  is_ipv6_enabled = true
  price_class     = "PriceClass_100" # North America + Europe
  http_version    = "http2and3"
  # NO default_root_object, deliberately. It rewrites ANY request whose uri is
  # "/" — including the strip_prefix function's forwarded S3 ListObjectsV2
  # calls for private origins (GET /?list-type=2 became GET /index.html →
  # NoSuchKey, breaking the storage browser's listing of mco-mesonet). The SPA
  # doesn't need it: its origin is an S3 *website* endpoint, which resolves
  # index.html for "/" on its own.
  aliases = var.enable_custom_domain ? [var.custom_domain] : []

  # Create one origin per PUBLIC data bucket (unauthenticated custom origin
  # against the S3 REST endpoint — these buckets allow public read).
  dynamic "origin" {
    for_each = { for k, v in var.origin_buckets : k => v if !v.private }
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

  # PRIVATE buckets (public-access-block on, e.g. mco-mesonet): CloudFront
  # signs origin requests via OAC, and the bucket's own policy — managed in
  # whatever repo owns that bucket — allows this distribution's ARN.
  dynamic "origin" {
    for_each = { for k, v in var.origin_buckets : k => v if v.private }
    content {
      domain_name              = origin.value.bucket_regional_domain
      origin_id                = origin.key
      origin_access_control_id = aws_cloudfront_origin_access_control.private_s3.id
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

  # Note: no custom_error_response blocks here. The S3 website hosting for the
  # storage browser app already serves index.html for 404s (via error_document).
  # Distribution-level error responses would intercept errors from data origins
  # too, breaking S3 ListBucket and proper 404s for missing data files.

  # Exact volatile paths (e.g. /mesonet/photos/manifest.parquet) — a single
  # object rewritten many times a day, so it must not inherit the archival TTL.
  # Declared before both blocks below: these are the most specific patterns, and
  # /<key>/* would otherwise swallow them.
  dynamic "ordered_cache_behavior" {
    for_each = { for p in var.volatile_exact_paths : p => split("/", trimprefix(p, "/"))[0] }
    content {
      path_pattern           = ordered_cache_behavior.key
      allowed_methods        = ["GET", "HEAD", "OPTIONS"]
      cached_methods         = ["GET", "HEAD"]
      target_origin_id       = ordered_cache_behavior.value
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
      acm_certificate_arn      = var.acm_certificate_arn
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
#
# For "directory" requests (no file extension), it returns a small HTML loader
# that fetches the SPA from /index.html. The SPA reads window.location.pathname
# and renders the file browser for that path.
resource "aws_cloudfront_function" "strip_prefix" {
  name    = "mco-strip-origin-prefix"
  runtime = "cloudfront-js-2.0"
  comment = "Strip origin prefix; serve SPA loader for directory paths"
  publish = true

  code = <<-JS
    function handler(event) {
      var request = event.request;
      var uri = request.uri;

      // The origin prefix (e.g. "snodas"), carried in a header that both cache
      // policies include in the cache key. The URI is stripped below before
      // the cache lookup happens, so without this every origin's /raw/... maps
      // to the same cache entry.
      var prefix = uri.split('/')[1] || '';
      request.headers['x-mco-origin'] = { value: prefix };

      // Strip the first path segment: /snodas/cogs/file.tif -> /cogs/file.tif
      var stripped = uri.replace(/^\/[^\/]+/, '') || '/';

      // If this is an S3 ListObjectsV2 call, always forward to S3
      if (request.querystring['list-type']) {
        request.uri = stripped;
        return request;
      }

      // Check if this looks like a directory (no file extension in last segment).
      // Directory paths like /snodas/cogs/ should serve the SPA, not hit S3.
      var segments = stripped.split('/').filter(function(s) { return s; });
      var lastSegment = segments[segments.length - 1];
      if (!lastSegment || lastSegment.indexOf('.') === -1) {
        return {
          statusCode: 200,
          statusDescription: 'OK',
          headers: {
            'content-type': { value: 'text/html' },
            'cache-control': { value: 'no-cache' }
          },
          body: '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>' +
                '<script>fetch("/index.html").then(function(r){return r.text()})' +
                '.then(function(h){document.open();document.write(h);document.close();})</script>' +
                '</body></html>'
        };
      }

      request.uri = stripped;
      return request;
    }
  JS
}
