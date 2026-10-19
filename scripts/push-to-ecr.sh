#!/usr/bin/env bash
#
# push-to-ecr.sh - build each RideNow service image and push it to Amazon ECR.
#
# This is the Stage 10 "image -> registry" step as a repeatable script. It does
# NOT create AWS resources and makes no changes unless you pass --push; by
# default it runs in dry-run mode and only prints the commands it would run, so
# you can read exactly what happens before anything touches AWS.
#
# Prerequisites (you provide these; the script does not create them):
#   - Docker running locally
#   - AWS CLI v2 configured (aws sts get-caller-identity should succeed)
#   - One ECR repository per service already created (Stage 10), e.g.
#       ridenow/user-service  ridenow/driver-service
#       ridenow/trip-service  ridenow/payment-service
#
# Usage:
#   AWS_ACCOUNT_ID=123456789012 AWS_REGION=ap-southeast-1 ./scripts/push-to-ecr.sh            # dry run
#   AWS_ACCOUNT_ID=123456789012 AWS_REGION=ap-southeast-1 ./scripts/push-to-ecr.sh --push     # real push
#   IMAGE_TAG=v1.0.0 ... ./scripts/push-to-ecr.sh --push                                       # custom tag
#
set -euo pipefail

# ---- Configuration (override via environment) --------------------------------
AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:-}"
AWS_REGION="${AWS_REGION:-ap-southeast-1}"
ECR_NAMESPACE="${ECR_NAMESPACE:-ridenow}"
IMAGE_TAG="${IMAGE_TAG:-local}"

# Each service: "<build-context-dir>:<ecr-repo-name>".
SERVICES=(
  "user-service:${ECR_NAMESPACE}/user-service"
  "driver-service:${ECR_NAMESPACE}/driver-service"
  "trip-service:${ECR_NAMESPACE}/trip-service"
  "payment-service:${ECR_NAMESPACE}/payment-service"
)

# --push performs the real work; default is a safe dry run.
DRY_RUN=1
if [[ "${1:-}" == "--push" ]]; then
  DRY_RUN=0
fi

if [[ -z "${AWS_ACCOUNT_ID}" ]]; then
  echo "ERROR: set AWS_ACCOUNT_ID (your 12-digit AWS account id)." >&2
  exit 1
fi

REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

run() {
  # Print the command; only execute it when not in dry-run mode.
  echo "+ $*"
  if [[ "${DRY_RUN}" -eq 0 ]]; then
    "$@"
  fi
}

echo "== RideNow ECR push =="
echo "   registry : ${REGISTRY}"
echo "   tag      : ${IMAGE_TAG}"
echo "   mode     : $([[ ${DRY_RUN} -eq 1 ]] && echo 'DRY RUN (no changes; pass --push to execute)' || echo 'PUSH')"
echo

# 1. Authenticate Docker to ECR (token is valid ~12h).
run bash -c "aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin ${REGISTRY}"

# 2. For each service: build the local image, tag it for ECR, push it.
for entry in "${SERVICES[@]}"; do
  dir="${entry%%:*}"
  repo="${entry##*:}"
  local_image="${dir}:${IMAGE_TAG}"
  remote_image="${REGISTRY}/${repo}:${IMAGE_TAG}"

  echo "-- ${dir} --"
  run docker build -t "${local_image}" "./${dir}"
  run docker tag "${local_image}" "${remote_image}"
  run docker push "${remote_image}"
  echo
done

echo "Done. In EKS, reference images as ${REGISTRY}/${ECR_NAMESPACE}/<service>:${IMAGE_TAG}"
