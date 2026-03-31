#!/usr/bin/env bash
# Build and deploy the Data Browser React app to S3 + CloudFront.
# Reads required values from terraform outputs — run `terraform apply` first.
# Usage: ./scripts/deploy-storage-browser.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TF_DIR="${REPO_ROOT}/terraform"
APP_DIR="${REPO_ROOT}/storage-browser"
PROFILE="${AWS_PROFILE:-mco}"
REGION="${AWS_REGION:-us-west-2}"

echo "=== Reading Terraform outputs ==="
cd "${TF_DIR}"
APP_BUCKET="$(terraform output -raw storage_browser_app_bucket)"
CF_DIST_ID="$(terraform output -raw storage_browser_cloudfront_id)"
BUCKETS_JSON="$(terraform output -raw storage_browser_buckets_json)"

echo "  App Bucket    : ${APP_BUCKET}"
echo "  CloudFront ID : ${CF_DIST_ID}"
echo "  Buckets       : ${BUCKETS_JSON}"

echo "=== Writing .env ==="
cd "${APP_DIR}"
cat > .env <<EOF
VITE_S3_BUCKETS=${BUCKETS_JSON}
VITE_AWS_REGION=${REGION}
EOF

echo "=== Installing dependencies ==="
npm install

echo "=== Building ==="
npm run build

echo "=== Syncing to S3 ==="
aws s3 sync dist/ "s3://${APP_BUCKET}/" \
  --profile "${PROFILE}" \
  --delete \
  --no-progress

echo "=== Invalidating CloudFront cache ==="
aws cloudfront create-invalidation \
  --distribution-id "${CF_DIST_ID}" \
  --paths "/*" \
  --profile "${PROFILE}" \
  --output text --query 'Invalidation.Id'

BROWSER_URL="$(cd "${TF_DIR}" && terraform output -raw storage_browser_url)"
echo ""
echo "=== Done ==="
echo "Data Browser: ${BROWSER_URL}"
