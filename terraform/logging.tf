# ---- Access logs: CloudFront standard logging (v2) → S3 ----------------------
#
# Every request to the distribution, delivered as gzipped W3C logs to a private
# bucket, partitioned {DistributionId}/{yyyy}/{MM}/{dd}/{HH}/. Logs carry
# client IPs, so the bucket is private with no CDN path.
#
# v2 logging goes through CloudWatch Logs vended delivery, not the legacy
# distribution `logging_config`, so the bucket needs no ACLs
# (BucketOwnerEnforced). The delivery source for a CloudFront distribution
# must be created in us-east-1; the S3 destination may live anywhere.

provider "aws" {
  alias   = "us_east_1"
  region  = "us-east-1"
  profile = var.aws_profile
}

data "aws_caller_identity" "current" {}

resource "aws_s3_bucket" "access_logs" {
  bucket = var.access_log_bucket
  tags   = local.common_tags
}

resource "aws_s3_bucket_public_access_block" "access_logs" {
  bucket = aws_s3_bucket.access_logs.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "access_logs" {
  bucket = aws_s3_bucket.access_logs.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "access_logs" {
  bucket = aws_s3_bucket.access_logs.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "access_logs" {
  bucket = aws_s3_bucket.access_logs.id

  rule {
    id     = "expire-access-logs"
    status = "Enabled"
    filter {}

    transition {
      days          = 30
      storage_class = "STANDARD_IA"
    }

    expiration {
      days = var.access_log_retention_days
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

resource "aws_s3_bucket_policy" "access_logs" {
  bucket = aws_s3_bucket.access_logs.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AWSLogDeliveryWrite"
        Effect    = "Allow"
        Principal = { Service = "delivery.logs.amazonaws.com" }
        Action    = "s3:PutObject"
        Resource  = "${aws_s3_bucket.access_logs.arn}/*"
        Condition = {
          StringEquals = {
            "s3:x-amz-acl"      = "bucket-owner-full-control"
            "aws:SourceAccount" = data.aws_caller_identity.current.account_id
          }
          ArnLike = {
            "aws:SourceArn" = "arn:aws:logs:us-east-1:${data.aws_caller_identity.current.account_id}:delivery-source:*"
          }
        }
      },
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource  = [aws_s3_bucket.access_logs.arn, "${aws_s3_bucket.access_logs.arn}/*"]
        Condition = { Bool = { "aws:SecureTransport" = "false" } }
      },
    ]
  })

  depends_on = [aws_s3_bucket_public_access_block.access_logs]
}

resource "aws_cloudwatch_log_delivery_source" "cdn" {
  provider = aws.us_east_1

  name         = "mco-data-cdn-access-logs"
  log_type     = "ACCESS_LOGS"
  resource_arn = aws_cloudfront_distribution.data.arn
  tags         = local.common_tags
}

resource "aws_cloudwatch_log_delivery_destination" "s3" {
  provider = aws.us_east_1

  name          = "mco-data-cdn-access-logs-s3"
  output_format = "w3c"

  delivery_destination_configuration {
    destination_resource_arn = aws_s3_bucket.access_logs.arn
  }

  tags = local.common_tags
}

resource "aws_cloudwatch_log_delivery" "cdn_to_s3" {
  provider = aws.us_east_1

  delivery_source_name     = aws_cloudwatch_log_delivery_source.cdn.name
  delivery_destination_arn = aws_cloudwatch_log_delivery_destination.s3.arn

  s3_delivery_configuration {
    suffix_path = "{DistributionId}/{yyyy}/{MM}/{dd}/{HH}"
  }

  depends_on = [aws_s3_bucket_policy.access_logs]
  tags       = local.common_tags
}
