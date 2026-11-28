#!/usr/bin/env bash
#
# teardown.sh - delete the RideNow CloudFormation stacks in REVERSE order.
#
# Because later layers import earlier layers' exports, they must be deleted in
# reverse (09 -> 01); CloudFormation refuses to delete a stack whose exports are
# still imported by a live stack.
#
# SAFETY: dry-run by default. Without --apply it only PRINTS the delete plan.
# For prod it additionally requires typing the environment name to confirm.
# RDS DeletionProtection is false, so the data stack deletes without a manual
# unlock; the DeletionPolicy=Snapshot still leaves a final snapshot behind.
#
# Usage:
#   ./scripts/teardown.sh dev              # print plan, delete nothing
#   ./scripts/teardown.sh dev --apply      # delete 09 -> 01
#
set -euo pipefail

ENV="${1:-}"
APPLY=0
if [[ "${2:-}" == "--apply" ]]; then
  APPLY=1
fi

if [[ "${ENV}" != "prod" ]]; then
  echo "Usage: $0 <prod> [--apply]" >&2
  exit 1
fi

AWS_REGION="${AWS_REGION:-ap-southeast-1}"

# Reverse of the deploy order. 09-observability is deleted first: it imports from
# earlier stacks and nothing imports it. 08-frontend is deployed separately
# (deploy-frontend.sh) and imports nothing. A stack that does not exist is skipped by CloudFormation.
LAYERS=(
  "09-observability"
  "08-frontend"
  "07-eks-addons"
  "06-eks-cluster"
  "05-messaging"
  "04-data"
  "03-ecr"
  "02-network"
  "01-iam"
)

echo "== RideNow IaC teardown =="
echo "   environment : ${ENV}"
echo "   region      : ${AWS_REGION}"
echo "   mode        : $([[ ${APPLY} -eq 0 ]] && echo 'DRY RUN (plan only; pass --apply to delete)' || echo 'DELETE')"
echo "   order       : ${LAYERS[*]}"
echo

if [[ ${APPLY} -eq 1 && "${ENV}" == "prod" ]]; then
  read -r -p "This DELETES the prod environment. Type 'prod' to confirm: " confirm
  if [[ "${confirm}" != "prod" ]]; then
    echo "Aborted." >&2
    exit 1
  fi
fi

# Empty the (versioned) frontend bucket. CloudFormation cannot delete a bucket that
# still holds objects or old versions.
empty_frontend_bucket() {
  local bucket
  bucket="$(aws cloudformation describe-stacks --region "${AWS_REGION}" \
    --stack-name "ridenow-${ENV}-08-frontend" \
    --query "Stacks[0].Outputs[?OutputKey=='BucketName'].OutputValue | [0]" \
    --output text 2>/dev/null | tr -d '\r' || true)"
  if [[ -z "${bucket}" || "${bucket}" == "None" ]]; then
    echo "  no frontend bucket found; nothing to empty."
    return 0
  fi
  echo "+ empty s3://${bucket} (all objects and versions)"
  if [[ ${APPLY} -eq 0 ]]; then
    return 0
  fi
  local batch
  while true; do
    batch="$(aws s3api list-object-versions --region "${AWS_REGION}" --bucket "${bucket}" \
      --max-items 1000 --output json \
      | jq -c '{Objects: ([(.Versions // [])[], (.DeleteMarkers // [])[]] | map({Key: .Key, VersionId: .VersionId})), Quiet: true}')"
    if [[ "$(echo "${batch}" | jq '.Objects | length')" -eq 0 ]]; then
      break
    fi
    aws s3api delete-objects --region "${AWS_REGION}" --bucket "${bucket}" --delete "${batch}" >/dev/null
  done
}

for layer in "${LAYERS[@]}"; do
  stack_name="ridenow-${ENV}-${layer}"
  echo "-- ${stack_name} --"
  if [[ "${layer}" == "08-frontend" ]]; then
    empty_frontend_bucket
  fi
  echo "+ aws cloudformation delete-stack --stack-name ${stack_name}"
  if [[ ${APPLY} -eq 1 ]]; then
    aws cloudformation delete-stack --region "${AWS_REGION}" --stack-name "${stack_name}"
    aws cloudformation wait stack-delete-complete --region "${AWS_REGION}" --stack-name "${stack_name}" || true
  fi
  echo
done

echo "Done (${ENV})."
if [[ ${APPLY} -eq 0 ]]; then
  echo "This was a DRY RUN. Re-run with --apply to delete for real."
fi
