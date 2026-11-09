#!/usr/bin/env bash
#
# cleanup-cluster.sh - delete the IN-CLUSTER and hand-created resources that
# teardown.sh (CloudFormation) does NOT manage.
#
# Why this exists: deploy was two halves. CloudFormation (stacks 01-07) created
# the infrastructure; the guides then created the running layer by hand with
# Helm / kubectl / aws CLI (service workloads, the Ingress-provisioned ALB, the
# per-service security groups, the KMS grant for External Secrets). Those are not
# stack-managed, so teardown.sh leaves them behind. Worse, the orphaned ALB holds
# ENIs in the subnets and BLOCKS the network stack (02) from deleting.
#
# Run this FIRST, then run teardown.sh. Order within this script matters:
# delete the Ingress (removes the ALB) before anything else, and revoke the
# per-service SG rules before teardown tries to delete the DB SG.
#
# SAFETY: dry-run by default. Without --apply it only PRINTS what it would do.
# For prod it additionally requires typing the environment name to confirm.
#
# Usage:
#   ./scripts/cleanup-cluster.sh prod              # print plan, delete nothing
#   ./scripts/cleanup-cluster.sh prod --apply      # delete in-cluster resources
#
# Prerequisites: kubectl pointed at the cluster
#   (aws eks update-kubeconfig --name ridenow-<env> --region <region>).
set -uo pipefail   # NOT -e: cleanup is best-effort; keep going if a thing is already gone.

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
CLUSTER="ridenow-${ENV}"

echo "== RideNow in-cluster cleanup =="
echo "   environment : ${ENV}"
echo "   cluster     : ${CLUSTER}"
echo "   region      : ${AWS_REGION}"
echo "   mode        : $([[ ${APPLY} -eq 0 ]] && echo 'DRY RUN (plan only; pass --apply to delete)' || echo 'DELETE')"
echo

if [[ ${APPLY} -eq 1 && "${ENV}" == "prod" ]]; then
  read -r -p "This DELETES the prod in-cluster resources. Type 'prod' to confirm: " confirm
  if [[ "${confirm}" != "prod" ]]; then
    echo "Aborted." >&2
    exit 1
  fi
fi

# run <description> <command...> : print, and execute only when --apply.
run() {
  local desc="$1"; shift
  echo "-- ${desc}"
  echo "+ $*"
  if [[ ${APPLY} -eq 1 ]]; then
    "$@" || echo "   (skipped/failed - likely already gone)"
  fi
  echo
}

# --- 1. Delete the Ingress FIRST (this deletes the ALB + its ENIs) -----------
# The ALB must go before the network stack, or stack 02 delete hangs on ENIs.
run "Delete Ingress (removes the ALB)" \
  kubectl delete ingress ridenow -n ridenow --ignore-not-found

if [[ ${APPLY} -eq 1 ]]; then
  echo "   waiting ~30s for the ALB to deprovision..."
  sleep 30
fi

# --- 2. Delete the application workloads -------------------------------------
run "Delete service manifests + SecurityGroupPolicies + namespace" \
  kubectl delete -f ../k8s/ --ignore-not-found --recursive

run "Delete the ridenow namespace (if any stragglers remain)" \
  kubectl delete namespace ridenow --ignore-not-found

# --- 3. Uninstall the Helm add-ons -------------------------------------------
run "Uninstall External Secrets Operator" \
  helm uninstall external-secrets -n external-secrets

run "Delete the external-secrets namespace" \
  kubectl delete namespace external-secrets --ignore-not-found

run "Uninstall AWS Load Balancer Controller" \
  helm uninstall aws-load-balancer-controller -n kube-system

run "Delete the aws-observability namespace (Fargate log router)" \
  kubectl delete namespace aws-observability --ignore-not-found

# --- 4. Revoke + delete the per-service security groups ----------------------
# These were created by hand (guide 06 step 2.5). They reference the DB SG, so
# they must be removed before teardown.sh deletes the network stack.
DB_SG="$(aws cloudformation list-exports --region "${AWS_REGION}" \
  --query "Exports[?Name=='ridenow-${ENV}-network-DbSecurityGroupId'].Value" \
  --output text 2>/dev/null || echo '')"

for SVC in user driver trip payment; do
  SG_NAME="ridenow-${ENV}-${SVC}-service-sg"
  SG_ID="$(aws ec2 describe-security-groups --region "${AWS_REGION}" \
    --filters "Name=group-name,Values=${SG_NAME}" \
    --query "SecurityGroups[0].GroupId" --output text 2>/dev/null || echo 'None')"

  if [[ "${SG_ID}" == "None" || -z "${SG_ID}" ]]; then
    echo "-- ${SG_NAME}: not found, skipping"
    echo
    continue
  fi

  if [[ -n "${DB_SG}" && "${DB_SG}" != "None" ]]; then
    run "Revoke 5432 ${SG_NAME} -> DB SG" \
      aws ec2 revoke-security-group-ingress --region "${AWS_REGION}" \
        --group-id "${DB_SG}" --protocol tcp --port 5432 --source-group "${SG_ID}"
  fi

  run "Delete ${SG_NAME} (${SG_ID})" \
    aws ec2 delete-security-group --region "${AWS_REGION}" --group-id "${SG_ID}"
done

# --- 5. Note the KMS grant ----------------------------------------------------
# The ESO KMS grant is on the RDS KMS key, which the data stack (04) deletes
# with the key, so the grant disappears with it - no explicit revoke needed.
echo "-- KMS grant for External Secrets: removed automatically when stack 04"
echo "   deletes the RDS KMS key. No action here."
echo

echo "Done (${ENV})."
if [[ ${APPLY} -eq 0 ]]; then
  echo "This was a DRY RUN. Re-run with --apply to delete for real."
  echo "Then run: ./scripts/teardown.sh ${ENV} --apply"
else
  echo "Next: ./scripts/teardown.sh ${ENV} --apply   (deletes the CloudFormation stacks 07 -> 01)"
fi
