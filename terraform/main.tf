terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Shared state bucket. Auth comes from the environment (AWS_PROFILE=mco
  # locally, OIDC role credentials in CI) — never hardcode a profile here.
  backend "s3" {
    bucket       = "mco-terraform-state"
    key          = "mco-data-cdn/terraform.tfstate"
    region       = "us-west-2"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile
}

locals {
  # The host the browser talks to: the custom domain once it is in front of
  # the distribution, otherwise the CloudFront domain.
  cdn_host = var.enable_custom_domain ? var.custom_domain : aws_cloudfront_distribution.data.domain_name

  common_tags = {
    Project   = "mco-data-cdn"
    ManagedBy = "terraform"
  }
}
