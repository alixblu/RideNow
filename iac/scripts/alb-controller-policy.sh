#!/usr/bin/env bash
#
# alb-controller-policy.sh - give the AWS Load Balancer Controller its IAM permissions.
#
# Stack 07 creates the controller's IRSA role (ridenow-<env>-alb-controller) with a
# trust policy only. The permissions policy is published by the controller project
# and changes between controller versions, so it is not kept in the template. This
# script downloads the policy for the controller version Helm installed, creates or
# updates the customer-managed policy AWSLoadBalancerControllerIAMPolicy, attaches it
# to the role, and restarts the controller so it picks the permissions up.
#
# Without it the Ingress never gets an address, and the controller logs
# "AccessDenied ... elasticloadbalancing:DescribeLoadBalancers".
#
# Run after the controller is installed with Helm (guides/cloudformation/07-eks-addons.md).
#
# Usage:
#   ./iac/scripts/alb-controller-policy.sh prod
#
set -euo pipefail

ENV="${1:-}"
if [[ "${ENV}" != "prod" ]]; then
  echo "Usage: $0 <prod>" >&2
  exit 1
fi
AWS_REGION="${AWS_REGION:-ap-southeast-1}"
ROLE="ridenow-${ENV}-alb-controller"
POLICY_NAME="AWSLoadBalancerControllerIAMPolicy"

for tool in aws helm jq curl kubectl; do
  command -v "${tool}" >/dev/null || { echo "ERROR: ${tool} is required" >&2; exit 1; }
done

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
POLICY_ARN="arn:aws:iam::${ACCOUNT_ID}:policy/${POLICY_NAME}"

VERSION="$(helm list -n kube-system -o json \
  | jq -r '.[] | select(.name=="aws-load-balancer-controller") | .app_version')"
if [[ -z "${VERSION}" || "${VERSION}" == "null" ]]; then
  echo "ERROR: aws-load-balancer-controller is not installed in kube-system (install it with Helm first)." >&2
  exit 1
fi
echo "controller version: ${VERSION}"

POLICY_FILE="$(mktemp)"
trap 'rm -f "${POLICY_FILE}"' EXIT
curl -fsSL -o "${POLICY_FILE}" \
  "https://raw.githubusercontent.com/kubernetes-sigs/aws-load-balancer-controller/${VERSION}/docs/install/iam_policy.json"

if aws iam get-policy --policy-arn "${POLICY_ARN}" >/dev/null 2>&1; then
  echo "updating ${POLICY_NAME} to the ${VERSION} policy"
  # IAM keeps at most 5 versions of a policy: drop the oldest non-default one first.
  COUNT="$(aws iam list-policy-versions --policy-arn "${POLICY_ARN}" --query 'length(Versions)' --output text)"
  if [[ "${COUNT}" -ge 5 ]]; then
    OLDEST="$(aws iam list-policy-versions --policy-arn "${POLICY_ARN}" \
      --query 'Versions[?IsDefaultVersion==`false`]|[-1].VersionId' --output text)"
    aws iam delete-policy-version --policy-arn "${POLICY_ARN}" --version-id "${OLDEST}"
  fi
  aws iam create-policy-version --policy-arn "${POLICY_ARN}" \
    --policy-document "file://${POLICY_FILE}" --set-as-default >/dev/null
else
  echo "creating ${POLICY_NAME}"
  aws iam create-policy --policy-name "${POLICY_NAME}" --policy-document "file://${POLICY_FILE}" >/dev/null
fi

aws iam attach-role-policy --role-name "${ROLE}" --policy-arn "${POLICY_ARN}"
echo "attached ${POLICY_NAME} to ${ROLE}"

kubectl rollout restart deployment aws-load-balancer-controller -n kube-system
kubectl rollout status deployment aws-load-balancer-controller -n kube-system --timeout=300s
echo "Done. The Ingress should get an address within a few minutes:"
echo "  kubectl get ingress -n ridenow"
