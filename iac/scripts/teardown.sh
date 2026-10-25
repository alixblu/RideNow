#!/usr/bin/env bash
#
# teardown.sh - delete the RideNow CloudFormation stacks in REVERSE order.
#
# Because later layers import earlier layers' exports, they must be deleted in
# reverse (07 -> 01); CloudFormation refuses to delete a stack whose exports are
# still imported by a live stack.
#
# SAFETY: dry-run by default. Without --apply it only PRINTS the delete plan.
# For prod it additionally requires typing the environment name to confirm, and
# note that RDS has DeletionProtection=true in staging/prod - you must disable
# that (or accept the retained snapshot) before the data stack will delete.
#
# Usage:
#   ./scripts/teardown.sh dev              # print plan, delete nothing
#   ./scripts/teardown.sh dev --apply      # delete 07 -> 01
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

# Reverse of the deploy order.
LAYERS=(
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

for layer in "${LAYERS[@]}"; do
  stack_name="ridenow-${ENV}-${layer}"
  echo "-- ${stack_name} --"
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
