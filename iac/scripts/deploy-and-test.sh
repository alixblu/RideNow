#!/usr/bin/env bash
#
# deploy-and-test.sh - deploy RideNow to an environment end to end, then run the API test.
#
# Runs the whole guide sequence (guides/cloudformation/01-iam.md to 08-frontend.md) in one go:
#
#   1. CloudFormation stacks 01 -> 07 (deploy.sh --apply --parallel; unchanged stacks are skipped)
#   2. kubeconfig, and a check that every service image exists in ECR for --tag
#   3. CoreDNS on the kube-system Fargate profile
#   4. AWS Load Balancer Controller (Helm) + its IAM policy (alb-controller-policy.sh)
#   5. External Secrets Operator (Helm, webhook on 9443) + KMS grant for its role
#   6. namespace + Fargate log router config (01-aws-logging.yaml) + ExternalSecrets (waits until all six DB secrets are synced)
#   7. the ADOT Collector (15-adot-collector.yaml, tag ADOT_COLLECTOR_TAG, default v0.51.0),
#      then the seven service manifests rendered from stack exports, then the Ingress
#   8. waits for the ALB to answer, port-forwards matching-service, runs scripts/api-test.ps1,
#      then checks X-Ray for trip-service traces (PASS/FAIL printed, exit code unaffected)
#
# Every step is idempotent, so re-running after a failure continues where it broke.
# Images are NOT built here: push them first (guides/scripts/push-to-ecr.sh) and pass
# their tag with --tag.
#
# SAFETY: this creates billable AWS resources (RDS, NAT gateways, EKS, ElastiCache, ALB).
# It asks you to type the environment name unless --yes is given.
#
# Usage (from the repo root, in WSL or Linux with aws, kubectl, helm, jq, curl):
#   ./iac/scripts/deploy-and-test.sh prod --tag v1.0.0
#   ./iac/scripts/deploy-and-test.sh prod --tag 20261124-1238 --skip-stacks --yes
#
# Options:
#   --tag TAG          image tag for all seven services (required)
#   --skip-stacks      skip step 1 (stacks already deployed)
#   --skip-test        stop after step 7
#   --app-origin URL   browser origin realtime-gateway allows for SSE (default http://localhost:5173)
#   --yes              do not ask for confirmation
#
# Exit code: 0 when the deploy succeeded and the API test passed.
#
set -euo pipefail

ENV="${1:-}"
shift || true
TAG=""
SKIP_STACKS=0
SKIP_TEST=0
YES=0
APP_ORIGIN="http://localhost:5173"

usage() {
  sed -n '2,/^set -euo/p' "$0" | sed -e '/^set -euo/d' -e 's/^# \{0,1\}//' >&2
  exit 1
}

[[ "${ENV}" == "prod" ]] || usage
while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag) TAG="${2:-}"; shift 2 ;;
    --skip-stacks) SKIP_STACKS=1; shift ;;
    --skip-test) SKIP_TEST=1; shift ;;
    --app-origin) APP_ORIGIN="${2:-}"; shift 2 ;;
    --yes) YES=1; shift ;;
    *) usage ;;
  esac
done
[[ -n "${TAG}" ]] || { echo "ERROR: --tag is required" >&2; usage; }

export AWS_REGION="${AWS_REGION:-ap-southeast-1}"
export AWS_DEFAULT_REGION="${AWS_REGION}"
export AWS_PAGER=""
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${REPO_DIR}"
CLUSTER="ridenow-${ENV}"
NS=ridenow
SERVICES=(user-service driver-service trip-service payment-service matching-service notification-worker realtime-gateway)
# Deploy order: payment before trip (trip authorizes synchronously), driver before
# matching (driver writes the location stream matching reads).
MANIFESTS=(20-user-service 23-payment-service 21-driver-service 22-trip-service 25-notification-worker 24-matching-service 26-realtime-gateway)
# Pinned ADOT Collector image tag; override with ADOT_COLLECTOR_TAG in the environment.
ADOT_COLLECTOR_TAG="${ADOT_COLLECTOR_TAG:-v0.51.0}"
PF_PID=""
trap '[[ -n "${PF_PID}" ]] && kill "${PF_PID}" 2>/dev/null || true' EXIT

for tool in aws kubectl helm jq curl sed; do
  command -v "${tool}" >/dev/null || { echo "ERROR: ${tool} is required" >&2; exit 1; }
done

step() { echo; echo "==== [$(date +%H:%M:%S)] $*"; }
die() { echo "ERROR: $*" >&2; exit 1; }
exp() {
  aws cloudformation list-exports --query "Exports[?Name=='$1'].Value" --output text
}
need_exp() {
  local v; v="$(exp "$1")"
  [[ -n "${v}" && "${v}" != "None" ]] || die "missing stack export $1 (are stacks 01-07 deployed?)"
  echo "${v}"
}

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)" || die "AWS credentials are not working (aws sts get-caller-identity failed)"
echo "== RideNow deploy and test"
echo "   environment : ${ENV}  (cluster ${CLUSTER}, region ${AWS_REGION}, account ${ACCOUNT_ID})"
echo "   image tag   : ${TAG}"
echo "   stacks      : $([[ ${SKIP_STACKS} -eq 1 ]] && echo skipped || echo 'deploy.sh --apply --parallel')"
echo "   api test    : $([[ ${SKIP_TEST} -eq 1 ]] && echo skipped || echo scripts/api-test.ps1)"
if [[ ${YES} -ne 1 ]]; then
  echo "This creates or changes billable AWS resources."
  read -r -p "Type the environment name (${ENV}) to continue: " answer
  [[ "${answer}" == "${ENV}" ]] || die "not confirmed"
fi

# ---------------------------------------------------------------------------
if [[ ${SKIP_STACKS} -eq 0 ]]; then
  step "1/8 CloudFormation stacks"
  ./iac/scripts/deploy.sh "${ENV}" --apply --parallel
fi

# ---------------------------------------------------------------------------
step "2/8 kubeconfig and images"
aws eks update-kubeconfig --name "${CLUSTER}" >/dev/null
kubectl get svc kubernetes >/dev/null || die "cannot reach the ${CLUSTER} API server"
for svc in "${SERVICES[@]}"; do
  aws ecr describe-images --repository-name "ridenow/${svc}" --image-ids "imageTag=${TAG}" >/dev/null 2>&1 \
    || die "image ridenow/${svc}:${TAG} is not in ECR (push it first)"
done
echo "all ${#SERVICES[@]} images exist with tag ${TAG}"

# ---------------------------------------------------------------------------
step "3/8 CoreDNS on Fargate"
if kubectl get deployment coredns -n kube-system -o jsonpath='{.spec.template.metadata.annotations}' | grep -q compute-type; then
  kubectl patch deployment coredns -n kube-system --type=json \
    -p='[{"op":"remove","path":"/spec/template/metadata/annotations/eks.amazonaws.com~1compute-type"}]'
fi
# Pods created before the kube-system Fargate profile was Active stay Pending forever;
# recreate them only when CoreDNS is not fully available.
want="$(kubectl get deployment coredns -n kube-system -o jsonpath='{.spec.replicas}')"
have="$(kubectl get deployment coredns -n kube-system -o jsonpath='{.status.availableReplicas}')"
if [[ "${have:-0}" != "${want}" ]]; then
  kubectl rollout restart deployment coredns -n kube-system
fi
kubectl rollout status deployment coredns -n kube-system --timeout=600s

# ---------------------------------------------------------------------------
step "4/8 AWS Load Balancer Controller"
helm repo add eks https://aws.github.io/eks-charts >/dev/null 2>&1 || true
helm repo add external-secrets https://charts.external-secrets.io >/dev/null 2>&1 || true
helm repo update >/dev/null
helm upgrade --install aws-load-balancer-controller eks/aws-load-balancer-controller -n kube-system \
  --set clusterName="${CLUSTER}" \
  --set serviceAccount.create=true \
  --set serviceAccount.name=aws-load-balancer-controller \
  --set "serviceAccount.annotations.eks\.amazonaws\.com/role-arn=$(need_exp "ridenow-${ENV}-eks-AlbControllerRoleArn")" \
  --set region="${AWS_REGION}" \
  --set vpcId="$(need_exp "ridenow-${ENV}-network-VpcId")" \
  --wait --timeout 10m >/dev/null
./iac/scripts/alb-controller-policy.sh "${ENV}"

# ---------------------------------------------------------------------------
step "5/8 External Secrets Operator"
ESO_ROLE="$(need_exp "ridenow-${ENV}-eks-ExternalSecretsRoleArn")"
KMS_ARN="$(aws kms describe-key --key-id "alias/ridenow-${ENV}-rds" --query KeyMetadata.Arn --output text)"
# Match the grant by grantee, not by name: a grant left from an earlier cluster names a
# role that was deleted and recreated, and does not apply to the new one.
if aws kms list-grants --key-id "${KMS_ARN}" --query "Grants[?GranteePrincipal=='${ESO_ROLE}'].GrantId" --output text | grep -q .; then
  echo "KMS grant for ${ESO_ROLE} exists"
else
  aws kms create-grant --key-id "${KMS_ARN}" --grantee-principal "${ESO_ROLE}" \
    --operations Decrypt DescribeKey --name "eso-decrypt-${CLUSTER}" --query GrantId --output text >/dev/null
  echo "created KMS grant for ${ESO_ROLE}"
fi
# webhook.port=9443: the chart default (10250) is the Fargate kubelet's port, so the
# API server's webhook calls would reach the kubelet and every ExternalSecret apply fails.
helm upgrade --install external-secrets external-secrets/external-secrets -n external-secrets --create-namespace \
  --set serviceAccount.annotations."eks\.amazonaws\.com/role-arn"="${ESO_ROLE}" \
  --set webhook.port=9443 \
  --wait --timeout 10m >/dev/null
kubectl get pods -n external-secrets

# ---------------------------------------------------------------------------
step "6/8 namespace and database secrets"
kubectl apply -f iac/k8s/00-namespace.yaml
# Fargate log router config (aws-observability ns + aws-logging ConfigMap). Must exist
# before the service pods start, because Fargate reads it at pod launch.
kubectl apply -f iac/k8s/01-aws-logging.yaml
sed -e "s|<REGION>|${AWS_REGION}|g" \
    -e "s|<USER_SECRET_ARN>|$(need_exp "ridenow-${ENV}-data-UserDbSecretArn")|g" \
    -e "s|<DRIVER_SECRET_ARN>|$(need_exp "ridenow-${ENV}-data-DriverDbSecretArn")|g" \
    -e "s|<TRIP_SECRET_ARN>|$(need_exp "ridenow-${ENV}-data-TripDbSecretArn")|g" \
    -e "s|<PAYMENT_SECRET_ARN>|$(need_exp "ridenow-${ENV}-data-PaymentDbSecretArn")|g" \
    -e "s|<MATCHING_SECRET_ARN>|$(need_exp "ridenow-${ENV}-data-MatchingDbSecretArn")|g" \
    -e "s|<NOTIFICATION_SECRET_ARN>|$(need_exp "ridenow-${ENV}-data-NotificationDbSecretArn")|g" \
    iac/k8s/10-external-secrets.yaml | kubectl apply -f -
kubectl wait --for=condition=Ready externalsecret --all -n "${NS}" --timeout=300s \
  || { kubectl get externalsecret -n "${NS}"; die "database secrets did not sync (see: kubectl logs -n external-secrets deploy/external-secrets)"; }
kubectl get externalsecret -n "${NS}"

# ---------------------------------------------------------------------------
step "7/8 services and Ingress"
declare -A V=(
  [ACCOUNT_ID]="${ACCOUNT_ID}" [REGION]="${AWS_REGION}" [IMAGE_TAG]="${TAG}" [ENV]="${ENV}"
  [APP_ORIGIN]="${APP_ORIGIN}"
  [ADOT_COLLECTOR_TAG]="${ADOT_COLLECTOR_TAG}"
  [ADOT_COLLECTOR_ROLE_ARN]="$(need_exp "ridenow-${ENV}-eks-AdotCollectorRoleArn")"
  [REDIS_ENDPOINT]="$(need_exp "ridenow-${ENV}-messaging-RedisPrimaryEndpoint")"
  [USER_DB_ENDPOINT]="$(need_exp "ridenow-${ENV}-data-UserDbEndpoint")"
  [DRIVER_DB_ENDPOINT]="$(need_exp "ridenow-${ENV}-data-DriverDbEndpoint")"
  [TRIP_DB_ENDPOINT]="$(need_exp "ridenow-${ENV}-data-TripDbEndpoint")"
  [PAYMENT_DB_ENDPOINT]="$(need_exp "ridenow-${ENV}-data-PaymentDbEndpoint")"
  [MATCHING_DB_ENDPOINT]="$(need_exp "ridenow-${ENV}-data-MatchingDbEndpoint")"
  [NOTIFICATION_DB_ENDPOINT]="$(need_exp "ridenow-${ENV}-data-NotificationDbEndpoint")"
  [TRIP_SERVICE_ROLE_ARN]="$(need_exp "ridenow-${ENV}-eks-TripServiceRoleArn")"
  [PAYMENT_SERVICE_ROLE_ARN]="$(need_exp "ridenow-${ENV}-eks-PaymentServiceRoleArn")"
  [MATCHING_SERVICE_ROLE_ARN]="$(need_exp "ridenow-${ENV}-eks-MatchingServiceRoleArn")"
  [NOTIFICATION_WORKER_ROLE_ARN]="$(need_exp "ridenow-${ENV}-eks-NotificationWorkerRoleArn")"
  [MATCHING_QUEUE_URL]="$(need_exp "ridenow-${ENV}-messaging-MatchingQueueUrl")"
  [PAYMENT_QUEUE_URL]="$(need_exp "ridenow-${ENV}-messaging-PaymentQueueUrl")"
  [NOTIFICATIONS_QUEUE_URL]="$(need_exp "ridenow-${ENV}-messaging-NotificationQueueUrl")"
)
SED_ARGS=()
for k in "${!V[@]}"; do SED_ARGS+=(-e "s|<${k}>|${V[$k]}|g"); done

render_and_apply() {
  local m="$1" rendered left
  rendered="$(sed "${SED_ARGS[@]}" "iac/k8s/${m}.yaml")"
  left="$(grep -vE '^\s*#' <<<"${rendered}" | grep -oE '<[A-Z_]+>' | sort -u | tr '\n' ' ' || true)"
  [[ -z "${left}" ]] || die "${m}.yaml still has placeholders: ${left}"
  echo "-- ${m}"
  kubectl apply -f - <<<"${rendered}"
}

# The ADOT Collector goes first so the services have an OTLP endpoint when they start.
render_and_apply 15-adot-collector
kubectl rollout status deployment/adot-collector -n "${NS}" --timeout=600s

for m in "${MANIFESTS[@]}"; do
  rendered="$(sed "${SED_ARGS[@]}" "iac/k8s/${m}.yaml")"
  left="$(grep -vE '^\s*#' <<<"${rendered}" | grep -oE '<[A-Z_]+>' | sort -u | tr '\n' ' ' || true)"
  [[ -z "${left}" ]] || die "${m}.yaml still has placeholders: ${left}"
  echo "-- ${m}"
  kubectl apply -f - <<<"${rendered}"
done
for m in "${MANIFESTS[@]}"; do
  svc="${m#*-}"
  kubectl rollout status "deployment/${svc}" -n "${NS}" --timeout=900s
done
kubectl apply -f iac/k8s/30-ingress.yaml
kubectl get pods -n "${NS}"

echo "waiting for the ALB address ..."
HOST=""
for _ in $(seq 1 60); do
  HOST="$(kubectl get ingress ridenow -n "${NS}" -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || true)"
  [[ -n "${HOST}" ]] && break
  sleep 10
done
[[ -n "${HOST}" ]] || { kubectl describe ingress ridenow -n "${NS}" | tail -10; die "the Ingress got no address in 10 minutes"; }
BASE="http://${HOST}"
echo "ALB: ${BASE}"
echo "waiting for the ALB to answer (DNS and target health take a few minutes) ..."
code=000
for _ in $(seq 1 60); do
  code="$(curl -s -o /dev/null -m 10 -w '%{http_code}' "${BASE}/api/users?limit=1" || true)"
  [[ "${code}" == "200" ]] && break
  sleep 10
done
[[ "${code}" == "200" ]] || die "the ALB did not answer 200 in 10 minutes (last: ${code})"
echo "ALB answers 200"

# ---------------------------------------------------------------------------
if [[ ${SKIP_TEST} -eq 1 ]]; then
  echo; echo "Deployed. API test skipped. ALB: ${BASE}"
  exit 0
fi
step "8/8 API test"
# matching-service has no public route; reach it through a port-forward. --address 0.0.0.0
# lets the Windows side reach it when this runs in WSL.
kubectl port-forward -n "${NS}" svc/matching-service 18085:8085 --address 0.0.0.0 >/dev/null 2>&1 &
PF_PID=$!
for _ in $(seq 1 20); do
  curl -s -o /dev/null -m 3 "http://localhost:18085/api/matching/trips/00000000-0000-0000-0000-000000000000/offers" && break
  sleep 1
done

if command -v pwsh >/dev/null; then
  PS=(pwsh -NoProfile -File scripts/api-test.ps1)
elif command -v powershell.exe >/dev/null; then
  PS=(powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(wslpath -w scripts/api-test.ps1)")
else
  die "PowerShell is needed for scripts/api-test.ps1 (install pwsh, or run from WSL)"
fi
set +e
"${PS[@]}" -BaseUrl "${BASE}" -MatchUrl http://localhost:18085 -SkipHealth
rc=$?
set -e

# X-Ray check (informational): never changes the API test exit code.
step "X-Ray traces"
xray_start="$(date -u -d '10 minutes ago' +%s 2>/dev/null || true)"
xray_end="$(date -u +%s)"
traces=""
if [[ -n "${xray_start}" ]]; then
  traces="$(aws xray get-trace-summaries --start-time "${xray_start}" --end-time "${xray_end}" \
    --filter-expression 'service("trip-service")' \
    --query 'length(TraceSummaries)' --output text 2>/dev/null || true)"
fi
if [[ "${traces}" =~ ^[0-9]+$ && "${traces}" -gt 0 ]]; then
  echo "X-RAY CHECK PASS: ${traces} trace(s) for service trip-service in the last 10 minutes"
else
  echo "X-RAY CHECK FAIL: no traces for service trip-service in the last 10 minutes"
  echo "Check the Collector: kubectl logs deploy/adot-collector -n ${NS}"
fi

echo
if [[ ${rc} -eq 0 ]]; then
  echo "DEPLOY AND TEST PASSED (${ENV}, tag ${TAG}). ALB: ${BASE}"
else
  echo "API TEST FAILED (exit ${rc}). The deploy itself finished. ALB: ${BASE}"
  echo "A 503 on the first 'create trip' right after a deploy is the payment cold start"
  echo "(see docs/SERVICES.md, trip-service); run the test again to tell it apart from a real failure."
fi
exit "${rc}"
