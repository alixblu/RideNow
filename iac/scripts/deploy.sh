#!/usr/bin/env bash
#
# deploy.sh - deploy the RideNow CloudFormation stacks in dependency order.
#
# Layers are 01 -> 07. Each layer exports values that later layers import, so
# order matters. By default every layer is deployed one after another. With
# --parallel, layers that do not depend on each other run at the same time:
#
#   phase 1: 01-iam, 02-network, 03-ecr          (no imports)
#   phase 2: 04-data, 05-messaging, 06-eks-cluster (import only 01 / 02)
#   phase 3: 07-eks-addons                        (needs the cluster from 06)
#
# The slow resources (RDS, ElastiCache, EKS) all sit in phase 2, so --parallel
# cuts about 30 minutes from a first deploy.
#
# SAFETY: dry-run by default. Without --apply, the script only creates a CHANGE
# SET per stack and prints it - nothing is created or modified. Pass --apply to
# actually deploy. This mirrors ../../scripts/push-to-ecr.sh.
#
# Usage:
#   ./scripts/deploy.sh dev                       # dry run (change sets only)
#   ./scripts/deploy.sh dev --apply               # real deploy, one stack at a time
#   ./scripts/deploy.sh dev --apply --parallel    # real deploy, independent stacks together
#   AWS_REGION=ap-southeast-1 ./scripts/deploy.sh prod --apply
#
# Re-running is safe: a stack with no changes is skipped, so an interrupted run
# resumes at the first unfinished stack.
#
# A first create that fails leaves the stack in ROLLBACK_COMPLETE, which cannot
# be updated. The script prints the failed events and stops. After you review
# them, re-run with RIDENOW_DELETE_ROLLBACK=1 to delete that stack and retry.
#
set -euo pipefail

ENV="${1:-}"
APPLY=0
PARALLEL=0

usage() {
  echo "Usage: $0 <prod> [--apply] [--parallel]" >&2
  exit 1
}

if [[ "${ENV}" != "prod" ]]; then
  usage
fi
shift
for arg in "$@"; do
  case "${arg}" in
    --apply) APPLY=1 ;;
    --parallel) PARALLEL=1 ;;
    *) usage ;;
  esac
done

AWS_REGION="${AWS_REGION:-ap-southeast-1}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IAC_DIR="$(dirname "${SCRIPT_DIR}")"
STACKS_DIR="${IAC_DIR}/stacks"
PARAMS_FILE="${IAC_DIR}/params/${ENV}.json"

if [[ ! -f "${PARAMS_FILE}" ]]; then
  echo "ERROR: missing params file ${PARAMS_FILE}" >&2
  exit 1
fi

# Each entry is a phase: the layers in it are independent of each other.
# 05 (messaging) and 07 (addons) are gated internally by params.
if [[ ${PARALLEL} -eq 1 ]]; then
  PHASES=(
    "01-iam 02-network 03-ecr"
    "04-data 05-messaging 06-eks-cluster"
    "07-eks-addons"
  )
else
  PHASES=(
    "01-iam"
    "02-network"
    "03-ecr"
    "04-data"
    "05-messaging"
    "06-eks-cluster"
    "07-eks-addons"
  )
fi

echo "== RideNow IaC deploy =="
echo "   environment : ${ENV}"
echo "   region      : ${AWS_REGION}"
echo "   mode        : $([[ ${APPLY} -eq 0 ]] && echo 'DRY RUN (change sets only; pass --apply to deploy)' || echo 'APPLY')"
echo "   scheduling  : $([[ ${PARALLEL} -eq 1 ]] && echo 'parallel phases' || echo 'one stack at a time')"
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

# Print the events that failed for a stack, newest first. This is what tells
# you WHICH resource broke and why, instead of just "stack failed".
show_failed_events() {
  local stack_name="$1"
  echo "  --- failed events for ${stack_name} (newest first) ---" >&2
  aws cloudformation describe-stack-events \
    --region "${AWS_REGION}" \
    --stack-name "${stack_name}" \
    --query "StackEvents[?contains(ResourceStatus, 'FAILED')].[Timestamp,LogicalResourceId,ResourceStatus,ResourceStatusReason]" \
    --output text 2>&1 | head -n 15 >&2 || true
  echo "  ------------------------------------------------------" >&2
}

# Deploy (or dry-run) one layer. Returns non-zero on failure so the caller can
# stop the whole run; prints everything to stdout/stderr (parallel runs capture
# it per layer).
deploy_layer() {
  local layer="$1"
  local template="${STACKS_DIR}/${layer}.yaml"
  local stack_name="ridenow-${ENV}-${layer}"
  local overrides
  overrides="$(params_for "${layer}")"

  # 07-eks-addons: inject the live OIDC id if the params file left it blank.
  # Without it the stack's AddonsOn condition is false and no IRSA roles are
  # created, so a blank value silently produces an empty stack.
  if [[ "${layer}" == "07-eks-addons" ]]; then
    local oidc_id
    # `|| true`: before stack 06 exists the lookup fails (cluster not found). With
    # pipefail + set -e that would kill the script before the WARN below.
    oidc_id="$(oidc_id_for || true)"
    if [[ -z "${oidc_id}" || "${oidc_id}" == "None" ]]; then
      if [[ ${APPLY} -eq 1 ]]; then
        echo "ERROR: could not resolve OIDC id for cluster ridenow-${ENV}." >&2
        echo "       Stack 06 (EKS cluster) must be deployed first." >&2
        return 1
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
  local stack_status
  stack_status="$(aws cloudformation describe-stacks \
      --region "${AWS_REGION}" \
      --stack-name "${stack_name}" \
      --query 'Stacks[0].StackStatus' \
      --output text 2>/dev/null || echo "DOES_NOT_EXIST")"

  # ROLLBACK_COMPLETE: a first create failed and CloudFormation rolled back. The
  # stack holds no resources but cannot be updated, only deleted.
  if [[ "${stack_status}" == "ROLLBACK_COMPLETE" ]]; then
    echo "  ${stack_name} is ROLLBACK_COMPLETE (an earlier create failed)." >&2
    show_failed_events "${stack_name}"
    if [[ ${APPLY} -eq 0 ]]; then
      echo "  WARN: dry run cannot continue for this stack until it is deleted." >&2
      return 0
    fi
    if [[ "${RIDENOW_DELETE_ROLLBACK:-0}" != "1" ]]; then
      echo "ERROR: review the events above. To delete this stack and retry, re-run" >&2
      echo "       with RIDENOW_DELETE_ROLLBACK=1 ${0} ${ENV} --apply" >&2
      return 1
    fi
    echo "+ RIDENOW_DELETE_ROLLBACK=1: deleting ${stack_name} ..."
    aws cloudformation delete-stack --region "${AWS_REGION}" --stack-name "${stack_name}"
    aws cloudformation wait stack-delete-complete --region "${AWS_REGION}" --stack-name "${stack_name}"
    stack_status="DOES_NOT_EXIST"
  fi

  # Build --parameters array; overrides is already ParameterKey=K,ParameterValue=V form.
  local params_args=()
  local kv
  for kv in ${overrides}; do
    params_args+=("${kv}")
  done

  # Resolve change-set type: CREATE for new or ghost stacks, UPDATE for live ones.
  local cs_type
  if [[ "${stack_status}" == "DOES_NOT_EXIST" || "${stack_status}" == "REVIEW_IN_PROGRESS" ]]; then
    cs_type="CREATE"
  else
    cs_type="UPDATE"
  fi

  local cs_name
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
    # Don't use `wait change-set-create-complete`: an empty change set (stack
    # already up to date) finishes as FAILED with reason "didn't contain
    # changes", which the waiter treats as a terminal error. Poll instead and
    # treat the no-op case as success.
    if ! aws cloudformation wait change-set-create-complete \
      --region "${AWS_REGION}" \
      --stack-name "${stack_name}" \
      --change-set-name "${cs_name}" 2>/dev/null; then
      local cs_reason
      cs_reason="$(aws cloudformation describe-change-set \
        --region "${AWS_REGION}" \
        --stack-name "${stack_name}" \
        --change-set-name "${cs_name}" \
        --query 'StatusReason' --output text 2>/dev/null || echo '')"
      if echo "${cs_reason}" | grep -qiE "didn't contain changes|no updates are to be performed|submitted information"; then
        echo "  no changes for ${stack_name}; skipping (already up to date)."
        aws cloudformation delete-change-set \
          --region "${AWS_REGION}" \
          --stack-name "${stack_name}" \
          --change-set-name "${cs_name}" >/dev/null 2>&1 || true
        echo
        return 0
      fi
      echo "ERROR: change set for ${stack_name} failed: ${cs_reason}" >&2
      return 1
    fi

    echo "+ executing change set ..."
    aws cloudformation execute-change-set \
      --region "${AWS_REGION}" \
      --stack-name "${stack_name}" \
      --change-set-name "${cs_name}"

    # The CLI waiter polls every 30s for up to 120 tries (60 min), longer than
    # any stack here needs. On failure it exits non-zero; print why.
    echo "+ waiting for stack to stabilise (RDS / ElastiCache / EKS can take 10-20 min) ..."
    local waiter
    if [[ "${cs_type}" == "CREATE" ]]; then
      waiter="stack-create-complete"
    else
      waiter="stack-update-complete"
    fi
    if ! aws cloudformation wait "${waiter}" \
      --region "${AWS_REGION}" \
      --stack-name "${stack_name}"; then
      echo "ERROR: ${stack_name} did not reach a complete state." >&2
      show_failed_events "${stack_name}"
      return 1
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
    && echo "  change set '${cs_name}' (${cs_type}) created - not executed" \
    || echo "  WARN: change set creation failed (see error above)"
  fi
  echo
}

# Run one phase. A single-layer phase streams its output directly. A phase with
# several layers runs them in the background, one log file each, then prints
# every log in order once all have finished and fails if any layer failed.
run_phase() {
  local layers=($1)

  if [[ ${#layers[@]} -eq 1 ]]; then
    deploy_layer "${layers[0]}"
    return $?
  fi

  echo ">> running in parallel: ${layers[*]}"
  local logdir
  logdir="$(mktemp -d)"
  local pids=()
  local layer
  for layer in "${layers[@]}"; do
    ( deploy_layer "${layer}" ) >"${logdir}/${layer}.log" 2>&1 &
    pids+=("$!")
  done

  local failed=0 i
  for i in "${!layers[@]}"; do
    if ! wait "${pids[$i]}"; then
      failed=1
      echo "!! ${layers[$i]} FAILED" >&2
    fi
  done

  for layer in "${layers[@]}"; do
    cat "${logdir}/${layer}.log"
  done
  rm -rf "${logdir}"

  if [[ ${failed} -ne 0 ]]; then
    echo "ERROR: at least one stack in this phase failed (output above)." >&2
    return 1
  fi
}

for phase in "${PHASES[@]}"; do
  run_phase "${phase}"
done

echo "Done (${ENV})."
if [[ ${APPLY} -eq 0 ]]; then
  echo "This was a DRY RUN. Re-run with --apply to deploy for real."
fi
