# =============================================================================
# Certificate auto-renewal: Let's Encrypt → ACM, daily Lambda
#
# CloudFront serves data2 with an IMPORTED ACM certificate (var.acm_certificate_arn),
# and ACM never renews imported certificates. climate.umt.edu is a CNAME to
# GitHub Pages, so this name inherits GitHub's CAA set, which allows
# letsencrypt.org but neither amazon.com (ACM-issued) nor emsign.com (UM's
# CertiNext CA). So a Lambda (cert-renewer/handler.py) checks the certificate
# daily and, inside cert_renew_days of expiry, orders a Let's Encrypt
# certificate over HTTP-01 and re-imports it into the same ARN.
#
# HTTP-01 challenge files go in the storage browser bucket: /.well-known/*
# matches no /<origin>/* behavior, so the default behavior serves it as-is.
#
# Two alarms email cert_alert_email: the Lambda erroring, and — independent
# of the Lambda — the certificate itself within 14 days of expiry.
# Everything lives in us-east-1, with the certificate and its ACM metrics.
#
# Retire all of this once data2 has its own Route 53 zone (mco-dns) with a CAA
# record allowing amazon.com: an ACM-issued certificate renews itself.
# =============================================================================

locals {
  cert_renewer_name = "mco-data-cdn-cert-renewer"
  acme_account_key  = "/mco-data-cdn/acme-account-key"
}

# Builds the package (handler + Linux wheels) on every plan; the archive hash
# only changes when its contents do.
data "external" "cert_renewer_build" {
  program = ["bash", "${path.module}/../scripts/build-cert-renewer.sh"]
}

data "archive_file" "cert_renewer" {
  type        = "zip"
  source_dir  = data.external.cert_renewer_build.result.dir
  output_path = "${path.module}/../build/cert-renewer.zip"
}

resource "aws_iam_role" "cert_renewer" {
  name = local.cert_renewer_name
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
  tags = local.common_tags
}

resource "aws_iam_role_policy_attachment" "cert_renewer_logs" {
  role       = aws_iam_role.cert_renewer.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "cert_renewer" {
  name = local.cert_renewer_name
  role = aws_iam_role.cert_renewer.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["acm:DescribeCertificate", "acm:ImportCertificate"]
        Resource = var.acm_certificate_arn
      },
      {
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:DeleteObject"]
        Resource = "${aws_s3_bucket.storage_browser_app.arn}/.well-known/acme-challenge/*"
      },
      {
        # SecureString under the AWS-managed aws/ssm key, whose key policy
        # already allows use through SSM by principals in this account.
        Effect   = "Allow"
        Action   = ["ssm:GetParameter", "ssm:PutParameter"]
        Resource = "arn:aws:ssm:us-east-1:${data.aws_caller_identity.current.account_id}:parameter${local.acme_account_key}"
      },
    ]
  })
}

resource "aws_cloudwatch_log_group" "cert_renewer" {
  provider          = aws.us_east_1
  name              = "/aws/lambda/${local.cert_renewer_name}"
  retention_in_days = 90
  tags              = local.common_tags
}

resource "aws_lambda_function" "cert_renewer" {
  provider         = aws.us_east_1
  function_name    = local.cert_renewer_name
  description      = "Renews ${var.custom_domain}'s Let's Encrypt certificate into ACM"
  role             = aws_iam_role.cert_renewer.arn
  runtime          = "python3.12"
  handler          = "handler.handler"
  filename         = data.archive_file.cert_renewer.output_path
  source_code_hash = data.archive_file.cert_renewer.output_base64sha256
  timeout          = 300
  memory_size      = 256

  environment {
    variables = {
      DOMAIN            = var.custom_domain
      CERT_ARN          = var.acm_certificate_arn
      CHALLENGE_BUCKET  = aws_s3_bucket.storage_browser_app.id
      ACCOUNT_KEY_PARAM = local.acme_account_key
      RENEW_DAYS        = tostring(var.cert_renew_days)
    }
  }

  depends_on = [aws_cloudwatch_log_group.cert_renewer]
  tags       = local.common_tags
}

resource "aws_cloudwatch_event_rule" "cert_renewer" {
  provider            = aws.us_east_1
  name                = local.cert_renewer_name
  description         = "Daily certificate expiry check for ${var.custom_domain}"
  schedule_expression = "cron(0 15 * * ? *)" # 09:00 MDT / 08:00 MST
  tags                = local.common_tags
}

resource "aws_cloudwatch_event_target" "cert_renewer" {
  provider = aws.us_east_1
  rule     = aws_cloudwatch_event_rule.cert_renewer.name
  arn      = aws_lambda_function.cert_renewer.arn
}

resource "aws_lambda_permission" "cert_renewer_schedule" {
  provider      = aws.us_east_1
  statement_id  = "AllowDailySchedule"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.cert_renewer.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.cert_renewer.arn
}

# ---- Alerts -----------------------------------------------------------------
resource "aws_sns_topic" "cert_alerts" {
  provider = aws.us_east_1
  name     = "mco-data-cdn-cert-alerts"
  tags     = local.common_tags
}

# Email subscriptions stay "pending confirmation" until the link in AWS's
# confirmation email is clicked.
resource "aws_sns_topic_subscription" "cert_alerts_email" {
  provider  = aws.us_east_1
  topic_arn = aws_sns_topic.cert_alerts.arn
  protocol  = "email"
  endpoint  = var.cert_alert_email
}

resource "aws_cloudwatch_metric_alarm" "cert_renewer_errors" {
  provider            = aws.us_east_1
  alarm_name          = "${local.cert_renewer_name}-errors"
  alarm_description   = "The ${var.custom_domain} cert renewer failed. Logs: /aws/lambda/${local.cert_renewer_name} (us-east-1)."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = aws_lambda_function.cert_renewer.function_name }
  statistic           = "Sum"
  period              = 86400
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.cert_alerts.arn]
  ok_actions          = [aws_sns_topic.cert_alerts.arn]
  tags                = local.common_tags
}

# Independent of the Lambda: fires if the certificate is close to expiry for
# any reason (renewer broken, schedule disabled, CAA changed, ...).
resource "aws_cloudwatch_metric_alarm" "cert_expiry" {
  provider            = aws.us_east_1
  alarm_name          = "mco-data-cdn-cert-expiring"
  alarm_description   = "${var.custom_domain}'s certificate expires in under 14 days and has not been renewed."
  namespace           = "AWS/CertificateManager"
  metric_name         = "DaysToExpiry"
  dimensions          = { CertificateArn = var.acm_certificate_arn }
  statistic           = "Minimum"
  period              = 86400
  evaluation_periods  = 1
  threshold           = 14
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "ignore" # ACM publishes once a day
  alarm_actions       = [aws_sns_topic.cert_alerts.arn]
  ok_actions          = [aws_sns_topic.cert_alerts.arn]
  tags                = local.common_tags
}
