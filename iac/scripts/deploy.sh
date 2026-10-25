#!/usr/bin/env bash
#
# deploy.sh - deploy the RideNow CloudFormation stacks in dependency order.
#
# Layers are deployed 01 -> 07. Each layer exports values the next imports, so
# order matters and each deploy must finish before the next begins.
#
# SAFETY: dry-run by default. Without --apply, the script only creates a CHANGE
# SET per stack and prints it - nothing is created or modified. Pass --apply to
# actually deploy. This mirrors ../../scripts/push-to-ecr.sh.
#
# Usage:
#   ./scripts/deploy.sh dev                 # dry run (change sets only)
#   ./scripts/deploy.sh dev --apply         # real deploy
#   AWS_REGION=ap-southeast-1 ./scripts/deploy.sh prod --apply
#
set -euo pipefail

ENV="${1:-}"
APPLY=0
if [[ "${2:-}" == "--apply" ]]; then
  APPLY=1
fi

if [[ -z "${ENV}" || ! "${ENV}" =~ ^(dev|staging|prod)$ ]]; then
  echo "Usage: $0 <dev|staging|prod> [--apply]" >&2
  exit 1
fi

AWS_REGION="${AWS_REGION:-ap-southeast-1}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IAC_DIR="$(dirname "${SCRIPT_DIR}")"
STACKS_DIR="${IAC_DIR}/stacks"
PARAMS_FILE="${IAC_DIR}/params/${ENV}.json"

if [[ ! -f "${PARAMS_FILE}" ]]; then
  echo "ERROR: missing params file ${PARAMS_FILE}" >&2
  exit 1
fi

# Deploy order. 05 (messaging) and 07 (addons) are gated internally by params.
LAYERS=(
  "01-iam"
  "02-network"
  "03-ecr"
  "04-data"
  "05-messaging"
  "06-eks-cluster"
  "07-eks-addons"
)

echo "== RideNow IaC deploy =="
echo "   environment : ${ENV}"
echo "   region      : ${AWS_REGION}"
echo "   mode        : $([[ ${APPLY} -eq 0 ]] && echo 'DRY RUN (change sets only; pass --apply to deploy)' || echo 'APPLY')"
echo

# Build a CLI --parameters string for a layer from the JSON params file.
# Requires jq.
params_for() {
  local layer="$1"
  jq -r --arg l "${layer}" '
    .[$l] // {} | to_entries
    | map("ParameterKey=\(.key),ParameterValue=\(.value)")
    | join(" ")
  ' "${PARAMS_FILE}"
}

for layer in "${LAYERS[@]}"; do
  template="${STACKS_DIR}/${layer}.yaml"
  stack_name="ridenow-${ENV}-${layer}"
  overrides="$(params_for "${layer}")"

  echo "-- ${stack_name} --"
  # Always validate the template first.
  echo "+ aws cloudformation validate-template --template-body file://${template}"
  if [[ ${APPLY} -eq 1 ]]; then
    # shellcheck disable=SC2086
    aws cloudformation deploy \
      --region "${AWS_REGION}" \
      --stack-name "${stack_name}" \
      --template-file "${template}" \
      --capabilities CAPABILITY_NAMED_IAM \
      --parameter-overrides ${overrides}
  else
    # Dry run: produce a change set without executing it.
    echo "+ aws cloudformation deploy --no-execute-changeset --stack-name ${stack_name} ..."
    echo "  parameters: ${overrides}"
    # shellcheck disable=SC2086
    aws cloudformation deploy \
      --region "${AWS_REGION}" \
      --stack-name "${stack_name}" \
      --template-file "${template}" \
      --capabilities CAPABILITY_NAMED_IAM \
      --no-execute-changeset \
      --parameter-overrides ${overrides} || true
  fi
  echo
done

echo "Done (${ENV})."
if [[ ${APPLY} -eq 0 ]]; then
  echo "This was a DRY RUN. Re-run with --apply to deploy for real."
fi
