#!/usr/bin/env bash
#
# deploy-frontend.sh - deploy stack 08-frontend (S3 + CloudFront + GitHub deploy role).
#
# This stack is NOT part of deploy.sh. It needs the ALB DNS name, and the ALB
# only exists after the services and the Ingress are deployed. Run this after
# that step. The script finds the ALB hostname on its own.
#
# SAFETY: dry-run by default. Without --apply it creates a change set and prints
# it. Nothing is created or modified. Pass --apply to deploy.
#
# Usage:
#   ./iac/scripts/deploy-frontend.sh dev                # dry run
#   ./iac/scripts/deploy-frontend.sh dev --apply        # deploy
#
# Inputs (all optional):
#   ALB_DNS_NAME            ALB hostname. Default: read from the 'ridenow' Ingress
#                           in namespace 'ridenow' (kubectl must point at the cluster).
#   GITHUB_OIDC_PROVIDER_ARN  Overrides GithubOidcProviderArn from params/<env>.json.
#                           Leave both blank to skip the GitHub deploy role.
#   AWS_REGION              Default ap-southeast-1.
#
set -euo pipefail

# Never open a pager: it blocks scripts and CI.
export AWS_PAGER=""

ENV="${1:-}"
APPLY=0

usage() {
  echo "Usage: $0 <prod> [--apply]" >&2
  exit 1
}

if [[ "${ENV}" != "prod" ]]; then
  usage
fi
shift
for arg in "$@"; do
  case "${arg}" in
    --apply) APPLY=1 ;;
    *) usage ;;
  esac
done

AWS_REGION="${AWS_REGION:-ap-southeast-1}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IAC_DIR="$(dirname "${SCRIPT_DIR}")"
LAYER="08-frontend"
TEMPLATE="${IAC_DIR}/stacks/${LAYER}.yaml"
PARAMS_FILE="${IAC_DIR}/params/${ENV}.json"
STACK_NAME="ridenow-${ENV}-${LAYER}"

if [[ ! -f "${PARAMS_FILE}" ]]; then
  echo "ERROR: missing params file ${PARAMS_FILE}" >&2
  exit 1
fi

# Resolve the ALB hostname: explicit override, else the Ingress status.
ALB="${ALB_DNS_NAME:-}"
if [[ -z "${ALB}" ]]; then
  ALB="$(kubectl get ingress ridenow -n ridenow \
    -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null | tr -d '\r' || true)"
fi
if [[ -z "${ALB}" ]]; then
  if [[ ${APPLY} -eq 1 ]]; then
    echo "ERROR: could not find the ALB hostname." >&2
    echo "       Deploy the services and Ingress first (iac/k8s/30-ingress.yaml)," >&2
    echo "       or pass ALB_DNS_NAME=<hostname>." >&2
    exit 1
  fi
  ALB="alb-not-found-yet.invalid"
  echo "   WARN: ALB hostname not found. Using a placeholder for this dry run only." >&2
fi

echo "== RideNow frontend stack =="
echo "   environment : ${ENV}"
echo "   region      : ${AWS_REGION}"
echo "   stack       : ${STACK_NAME}"
echo "   alb         : ${ALB}"
echo "   mode        : $([[ ${APPLY} -eq 0 ]] && echo 'DRY RUN (change set only; pass --apply to deploy)' || echo 'APPLY')"
echo

# Parameters from the params file, with the resolved ALB (and optional OIDC ARN) merged in.
PARAMS_JSON="$(jq -c --arg l "${LAYER}" --arg alb "${ALB}" --arg oidc "${GITHUB_OIDC_PROVIDER_ARN:-}" '
  (.[$l] // {}) + {AlbDnsName: $alb}
  + (if $oidc != "" then {GithubOidcProviderArn: $oidc} else {} end)
' "${PARAMS_FILE}" | tr -d '\r')"

params_args=()
while IFS= read -r kv; do
  params_args+=("${kv}")
done < <(echo "${PARAMS_JSON}" | jq -r 'to_entries[] | "ParameterKey=\(.key),ParameterValue=\(.value)"' | tr -d '\r')

echo "+ aws cloudformation validate-template"
aws cloudformation validate-template --region "${AWS_REGION}" --template-body "file://${TEMPLATE}" >/dev/null

stack_status="$(aws cloudformation describe-stacks \
    --region "${AWS_REGION}" \
    --stack-name "${STACK_NAME}" \
    --query 'Stacks[0].StackStatus' \
    --output text 2>/dev/null || echo "DOES_NOT_EXIST")"

if [[ "${stack_status}" == "ROLLBACK_COMPLETE" ]]; then
  echo "  ${STACK_NAME} is ROLLBACK_COMPLETE (an earlier create failed)." >&2
  aws cloudformation describe-stack-events \
    --region "${AWS_REGION}" --stack-name "${STACK_NAME}" \
    --query "StackEvents[?contains(ResourceStatus, 'FAILED')].[Timestamp,LogicalResourceId,ResourceStatusReason]" \
    --output text 2>&1 | head -n 15 >&2 || true
  if [[ ${APPLY} -eq 0 ]]; then
    echo "  WARN: delete the stack before re-applying. Dry run stops here." >&2
    exit 0
  fi
  if [[ "${RIDENOW_DELETE_ROLLBACK:-0}" != "1" ]]; then
    echo "ERROR: review the events above. To delete this stack and retry, re-run with" >&2
    echo "       RIDENOW_DELETE_ROLLBACK=1 $0 ${ENV} --apply" >&2
    exit 1
  fi
  aws cloudformation delete-stack --region "${AWS_REGION}" --stack-name "${STACK_NAME}"
  aws cloudformation wait stack-delete-complete --region "${AWS_REGION}" --stack-name "${STACK_NAME}"
  stack_status="DOES_NOT_EXIST"
fi

if [[ "${stack_status}" == "DOES_NOT_EXIST" || "${stack_status}" == "REVIEW_IN_PROGRESS" ]]; then
  cs_type="CREATE"
else
  cs_type="UPDATE"
fi

if [[ ${APPLY} -eq 1 ]]; then
  cs_name="ridenow-apply-$(date +%s)"
else
  cs_name="ridenow-dryrun-$(date +%s)"
fi

echo "+ creating change set ${cs_name} (${cs_type}) ..."
aws cloudformation create-change-set \
  --region "${AWS_REGION}" \
  --stack-name "${STACK_NAME}" \
  --template-body "file://${TEMPLATE}" \
  --capabilities CAPABILITY_NAMED_IAM \
  --change-set-name "${cs_name}" \
  --change-set-type "${cs_type}" \
  --parameters "${params_args[@]}" >/dev/null

if ! aws cloudformation wait change-set-create-complete \
    --region "${AWS_REGION}" --stack-name "${STACK_NAME}" --change-set-name "${cs_name}" 2>/dev/null; then
  reason="$(aws cloudformation describe-change-set \
    --region "${AWS_REGION}" --stack-name "${STACK_NAME}" --change-set-name "${cs_name}" \
    --query 'StatusReason' --output text 2>/dev/null || echo '')"
  if echo "${reason}" | grep -qiE "didn't contain changes|no updates are to be performed|submitted information"; then
    echo "  no changes for ${STACK_NAME}; already up to date."
    aws cloudformation delete-change-set --region "${AWS_REGION}" \
      --stack-name "${STACK_NAME}" --change-set-name "${cs_name}" >/dev/null 2>&1 || true
    exit 0
  fi
  echo "ERROR: change set failed: ${reason}" >&2
  exit 1
fi

aws cloudformation describe-change-set \
  --region "${AWS_REGION}" --stack-name "${STACK_NAME}" --change-set-name "${cs_name}" \
  --query 'Changes[].ResourceChange.[Action,LogicalResourceId,ResourceType]' --output table

if [[ ${APPLY} -eq 0 ]]; then
  echo "  change set '${cs_name}' created - not executed."
  echo "This was a DRY RUN. Re-run with --apply to deploy for real."
  exit 0
fi

echo "+ executing change set (CloudFront takes about 5-10 min) ..."
aws cloudformation execute-change-set \
  --region "${AWS_REGION}" --stack-name "${STACK_NAME}" --change-set-name "${cs_name}"
if [[ "${cs_type}" == "CREATE" ]]; then waiter="stack-create-complete"; else waiter="stack-update-complete"; fi
if ! aws cloudformation wait "${waiter}" --region "${AWS_REGION}" --stack-name "${STACK_NAME}"; then
  echo "ERROR: ${STACK_NAME} did not reach a complete state." >&2
  aws cloudformation describe-stack-events \
    --region "${AWS_REGION}" --stack-name "${STACK_NAME}" \
    --query "StackEvents[?contains(ResourceStatus, 'FAILED')].[Timestamp,LogicalResourceId,ResourceStatusReason]" \
    --output text 2>&1 | head -n 15 >&2 || true
  exit 1
fi

echo
echo "${STACK_NAME} deployed. Outputs:"
aws cloudformation describe-stacks --region "${AWS_REGION}" --stack-name "${STACK_NAME}" \
  --query 'Stacks[0].Outputs[].[OutputKey,OutputValue]' --output table
