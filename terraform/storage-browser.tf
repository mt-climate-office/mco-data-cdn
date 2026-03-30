# =============================================================================
# STORAGE BROWSER — Amplify UI frontend for browsing all MCO data buckets
#
# Architecture:
#   Cognito Identity Pool (guest/unauthenticated) issues temporary AWS
#   credentials so the browser SDK can call s3:ListBucket / s3:GetObject
#   on every origin bucket. The React app is served from the root of the
#   main data CDN distribution (cdn.tf), with data paths taking priority.
# =============================================================================

# ---- Cognito Identity Pool (guest access, no login required) ----------------
resource "aws_cognito_identity_pool" "storage_browser" {
  identity_pool_name               = "mco-data-cdn-storage-browser"
  allow_unauthenticated_identities = true
  allow_classic_flow               = false

  tags = local.common_tags
}

# ---- IAM: unauthenticated (guest) role with read-only S3 access -------------
resource "aws_iam_role" "cognito_unauthenticated" {
  name = "mco-data-cdn-cognito-unauth"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = "cognito-identity.amazonaws.com" }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "cognito-identity.amazonaws.com:aud" = aws_cognito_identity_pool.storage_browser.id
        }
        "ForAnyValue:StringLike" = {
          "cognito-identity.amazonaws.com:amr" = "unauthenticated"
        }
      }
    }]
  })

  tags = local.common_tags
}

resource "aws_iam_role_policy" "cognito_unauthenticated_s3" {
  name = "s3-read-only"
  role = aws_iam_role.cognito_unauthenticated.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = [for _, b in var.origin_buckets : "arn:aws:s3:::${b.bucket_name}/*"]
      },
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = [for _, b in var.origin_buckets : "arn:aws:s3:::${b.bucket_name}"]
      }
    ]
  })
}

resource "aws_cognito_identity_pool_roles_attachment" "storage_browser" {
  identity_pool_id = aws_cognito_identity_pool.storage_browser.id
  roles = {
    unauthenticated = aws_iam_role.cognito_unauthenticated.arn
  }
}

# ---- S3 bucket: hosts the compiled React app --------------------------------
resource "aws_s3_bucket" "storage_browser_app" {
  bucket = "mco-data-cdn-browser-app"
  tags   = local.common_tags
}

resource "aws_s3_bucket_website_configuration" "storage_browser_app" {
  bucket = aws_s3_bucket.storage_browser_app.id
  index_document { suffix = "index.html" }
  error_document { key = "index.html" }
}

resource "aws_s3_bucket_public_access_block" "storage_browser_app" {
  bucket                  = aws_s3_bucket.storage_browser_app.id
  block_public_acls       = false
  block_public_policy     = false
  ignore_public_acls      = false
  restrict_public_buckets = false
}

resource "aws_s3_bucket_policy" "storage_browser_app_public" {
  bucket = aws_s3_bucket.storage_browser_app.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "PublicReadGetObject"
      Effect    = "Allow"
      Principal = "*"
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.storage_browser_app.arn}/*"
    }]
  })
  depends_on = [aws_s3_bucket_public_access_block.storage_browser_app]
}
