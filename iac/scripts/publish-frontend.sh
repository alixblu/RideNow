#!/usr/bin/env bash
#
# publish-frontend.sh - build the frontend and publish it to S3 + CloudFront.
#
# Used by the GitHub Actions deploy workflow and by hand, so both do the same
# thing. Reads the bucket, distribution and domain from the 08-frontend stack.
#
# Steps:
#   1. read stack outputs
#   2. pnpm install --frozen-lockfile, pnpm build (VITE_API_BASE_URL = the site URL)
#   3. sync dist/ to S3 in two passes: hashed assets/ (cached for a year), then
#      everything else including index.html (no-cache)
#   4. invalidate /index.html
#
# Usage:
#   ./iac/scripts/publish-frontend.sh dev
#   SKIP_INSTALL=1 ./iac/scripts/publish-frontend.sh dev   # CI already installed
#   SKIP_BUILD=1   ./iac/scripts/publish-frontend.sh dev   # CI already built, with the right URL
#   AWS_REGION=ap-southeast-1 (default)
#
set -euo pipefail

# Never open a pager: it blocks scripts and CI.
export AWS_PAGER=""

ENV="${1:-}"
if [[ "${ENV}" != "prod" ]]; then
  echo "Usage: $0 <prod>" >&2
  exit 1
fi

AWS_REGION="${AWS_REGION:-ap-southeast-1}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$(cd "${SCRIPT_DIR}/../../frontend" && pwd)"
STACK_NAME="ridenow-${ENV}-08-frontend"

output() {
  aws cloudformation describe-stacks \
    --region "${AWS_REGION}" \
    --stack-name "${STACK_NAME}" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue | [0]" \
    --output text | tr -d '\r'
}

BUCKET="$(output BucketName)"
DISTRIBUTION_ID="$(output DistributionId)"
DOMAIN="$(output DistributionDomain)"

for v in BUCKET DISTRIBUTION_ID DOMAIN; do
  if [[ -z "${!v}" || "${!v}" == "None" ]]; then
    echo "ERROR: ${STACK_NAME} has no ${v} output. Deploy it with deploy-frontend.sh first." >&2
    exit 1
  fi
done

echo "== RideNow frontend publish =="
echo "   environment  : ${ENV}"
echo "   bucket       : ${BUCKET}"
echo "   distribution : ${DISTRIBUTION_ID}"
echo "   site         : https://${DOMAIN}"
echo

cd "${FRONTEND_DIR}"

if [[ "${SKIP_INSTALL:-0}" != "1" ]]; then
  pnpm install --frozen-lockfile
fi

if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  # The app treats a blank VITE_API_BASE_URL as "no gateway" and calls localhost.
  # CloudFront serves the site and routes /api and /live, so the site URL is the API URL.
  VITE_API_BASE_URL="https://${DOMAIN}" pnpm build
fi

if [[ ! -f dist/index.html ]]; then
  echo "ERROR: dist/index.html not found. Build first, or do not set SKIP_BUILD." >&2
  exit 1
fi

# Pass 1: hashed assets. Safe to cache for a year because each build renames them.
aws s3 sync dist/ "s3://${BUCKET}/" \
  --region "${AWS_REGION}" \
  --exclude "*" --include "assets/*" \
  --cache-control "public,max-age=31536000,immutable"

# Pass 2: everything else. index.html must always be revalidated.
# --delete removes files that left the build, but only outside assets/ so that
# browsers holding an older index.html can still load its old hashed assets.
aws s3 sync dist/ "s3://${BUCKET}/" \
  --region "${AWS_REGION}" \
  --exclude "assets/*" \
  --cache-control "no-cache" \
  --delete

aws cloudfront create-invalidation \
  --distribution-id "${DISTRIBUTION_ID}" \
  --paths "/index.html" \
  --query 'Invalidation.[Id,Status]' --output text

echo
echo "Published: https://${DOMAIN}"
