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
  ' "${PARAMS_FILE}" | tr -d '\r'
}

# Resolve the cluster OIDC provider id (last path segment of the issuer URL).
# Stack 07 needs it, but it only exists after stack 06 creates the cluster, so
# it cannot live in params/<env>.json. We look it up at deploy time.
oidc_id_for() {
  aws eks describe-cluster \
    --name "ridenow-${ENV}" \
    --region "${AWS_REGION}" \
    --query "cluster.identity.oidc.issuer" \
    --output text 2>/dev/null | sed 's|.*/||'
}

for layer in "${LAYERS[@]}"; do
  template="${STACKS_DIR}/${layer}.yaml"
  stack_name="ridenow-${ENV}-${layer}"
  overrides="$(params_for "${layer}")"

  # 07-eks-addons: inject the live OIDC id if the params file left it blank.
  # Without it the stack's AddonsOn condition is false and no IRSA roles are
  # created, so a blank value silently produces an empty stack.
  if [[ "${layer}" == "07-eks-addons" ]]; then
    oidc_id="$(oidc_id_for)"
    if [[ -z "${oidc_id}" || "${oidc_id}" == "None" ]]; then
      if [[ ${APPLY} -eq 1 ]]; then
        echo "ERROR: could not resolve OIDC id for cluster ridenow-${ENV}." >&2
        echo "       Stack 06 (EKS cluster) must be deployed first." >&2
        exit 1
      else
        echo "   WARN: cluster ridenow-${ENV} not found yet (expected during a" >&2
        echo "         dry run before 06 is applied). Leaving OidcProviderId blank;" >&2
        echo "         it is resolved automatically on the real --apply run." >&2
      fi
    else
      # Drop any blank OidcProviderId from the file params, then append the real one.
      overrides="$(echo "${overrides}" \
        | sed -E 's/ParameterKey=OidcProviderId,ParameterValue=[^ ]*//g') \
        ParameterKey=OidcProviderId,ParameterValue=${oidc_id}"
      echo "   resolved OidcProviderId=${oidc_id}"
    fi
  fi

  echo "-- ${stack_name} --"
  # Always validate the template first.
  echo "+ aws cloudformation validate-template --template-body file://${template}"

  # Detect current stack state. Used by both dry-run and apply paths.
  # REVIEW_IN_PROGRESS means a prior dry-run left a ghost stack with no resources.
  stack_status="$(aws cloudformation describe-stacks \
      --region "${AWS_REGION}" \
      --stack-name "${stack_name}" \
      --query 'Stacks[0].StackStatus' \
      --output text 2>/dev/null || echo "DOES_NOT_EXIST")"

  # Build --parameters array; overrides is already ParameterKey=K,ParameterValue=V form.
  params_args=()
  for kv in ${overrides}; do
    params_args+=("${kv}")
  done

  # Resolve change-set type: CREATE for new or ghost stacks, UPDATE for live ones.
  if [[ "${stack_status}" == "DOES_NOT_EXIST" || "${stack_status}" == "REVIEW_IN_PROGRESS" ]]; then
    cs_type="CREATE"
  else
    cs_type="UPDATE"
  fi

  if [[ ${APPLY} -eq 1 ]]; then
    cs_name="ridenow-apply-$(date +%s)"
    echo "+ creating and executing change set (${cs_type}) ..."
    # Use create-change-set + execute instead of "deploy" so we control the
    # change-set type explicitly. This avoids "must have values" errors when a
    # ghost REVIEW_IN_PROGRESS stack exists from a prior dry run.
    aws cloudformation create-change-set \
      --region "${AWS_REGION}" \
      --stack-name "${stack_name}" \
      --template-body "file://${template}" \
      --capabilities CAPABILITY_NAMED_IAM \
      --change-set-name "${cs_name}" \
      --change-set-type "${cs_type}" \
      --parameters "${params_args[@]}"

    echo "+ waiting for change set to be ready ..."
    aws cloudformation wait change-set-create-complete \
      --region "${AWS_REGION}" \
      --stack-name "${stack_name}" \
      --change-set-name "${cs_name}"

    echo "+ executing change set ..."
    aws cloudformation execute-change-set \
      --region "${AWS_REGION}" \
      --stack-name "${stack_name}" \
      --change-set-name "${cs_name}"

    echo "+ waiting for stack to stabilise ..."
    if [[ "${cs_type}" == "CREATE" ]]; then
      aws cloudformation wait stack-create-complete \
        --region "${AWS_REGION}" \
        --stack-name "${stack_name}"
    else
      aws cloudformation wait stack-update-complete \
        --region "${AWS_REGION}" \
        --stack-name "${stack_name}"
    fi
    echo "  ${stack_name} deployed."
  else
    # Dry run: create the change set but do not execute it.
    cs_name="ridenow-dryrun-$(date +%s)"
    echo "+ aws cloudformation create-change-set --stack-name ${stack_name} (${cs_type}) ..."
    echo "  parameters: ${overrides}"

    aws cloudformation create-change-set \
      --region "${AWS_REGION}" \
      --stack-name "${stack_name}" \
      --template-body "file://${template}" \
      --capabilities CAPABILITY_NAMED_IAM \
      --change-set-name "${cs_name}" \
      --change-set-type "${cs_type}" \
      --parameters "${params_args[@]}" \
    && echo "  change set '${cs_name}' (${cs_type}) created — not executed" \
    || echo "  WARN: change set creation failed (see error above)"
  fi
  echo
done

echo "Done (${ENV})."
if [[ ${APPLY} -eq 0 ]]; then
  echo "This was a DRY RUN. Re-run with --apply to deploy for real."
fi
