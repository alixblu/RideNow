#!/usr/bin/env bash
#
# check-consistency.sh - static checks that the CloudFormation stacks, the k8s
# manifests, the params files and the guides all describe the same system.
#
# It needs only bash, grep, sed and awk (cfn-lint is used when installed). It
# calls no AWS API and changes nothing, so it is safe to run anywhere, and
# cheap enough to run before every deploy.
#
# Checks:
#   1. cfn-lint passes on every stack (skipped with a warning if not installed)
#   2. every <PLACEHOLDER> in iac/k8s has a source: a stack export or a known
#      deploy-time value
#   3. every *-db-credentials secret a Deployment reads has an ExternalSecret
#   4. one RDS instance per ExternalSecret, and every database name a manifest
#      connects to is created by stack 04
#   5. every service directory (pom.xml) has a manifest image and an ECR repo
#   6. every Ingress backend is a deployed service
#   7. every params file covers every stack
#   8. the guides do not link to the renamed 07-later-* / 08-later-* files
#
# Usage: ./iac/scripts/check-consistency.sh        (from anywhere)
# Exit code: 0 when all checks pass, 1 otherwise.
#
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IAC_DIR="$(dirname "${SCRIPT_DIR}")"
ROOT="$(dirname "${IAC_DIR}")"
STACKS="${IAC_DIR}/stacks"
K8S="${IAC_DIR}/k8s"
PARAMS="${IAC_DIR}/params"

FAILS=0
fail() { echo "  FAIL: $*"; FAILS=$((FAILS + 1)); }
ok()   { echo "  ok:   $*"; }
head_() { echo; echo "[$1] $2"; }

# SNAKE_CASE -> PascalCase (TRIP_SERVICE -> TripService).
pascal() {
  echo "$1" | awk -F'_' '{ for (i = 1; i <= NF; i++) printf "%s%s", toupper(substr($i,1,1)), tolower(substr($i,2)); print "" }'
}

# Every cross-stack export, as "<layer>-<Name>" (for example data-UserDbEndpoint).
EXPORTS="$(grep -hoE 'ridenow-\$\{Environment\}-[a-z]+-[A-Za-z]+"' "${STACKS}"/*.yaml \
  | sed -E 's/^ridenow-\$\{Environment\}-//; s/"$//' | sort -u)"
has_export() { echo "${EXPORTS}" | grep -qx "$1"; }

# ---------------------------------------------------------------- 1. cfn-lint
head_ 1 "cfn-lint on every stack"
if command -v cfn-lint >/dev/null 2>&1; then
  if cfn-lint "${STACKS}"/*.yaml; then ok "cfn-lint clean"; else fail "cfn-lint reported problems"; fi
else
  echo "  skip: cfn-lint not installed (pip install cfn-lint)"
fi

# --------------------------------------------------------- 2. placeholder sources
head_ 2 "k8s placeholders have a source"
# Values the operator supplies at deploy time, not exported by a stack.
DEPLOY_TIME="ACCOUNT_ID REGION IMAGE_TAG ENV APP_ORIGIN"
PLACEHOLDERS="$(grep -hoE '<[A-Z][A-Z0-9_]+>' "${K8S}"/*.yaml | tr -d '<>' | sort -u)"
for p in ${PLACEHOLDERS}; do
  if echo " ${DEPLOY_TIME} " | grep -q " ${p} "; then continue; fi
  case "${p}" in
    REDIS_ENDPOINT)        want="messaging-RedisPrimaryEndpoint" ;;
    NOTIFICATIONS_QUEUE_URL) want="messaging-NotificationQueueUrl" ;;
    *_DB_ENDPOINT)         want="data-$(pascal "${p%_DB_ENDPOINT}")DbEndpoint" ;;
    *_SECRET_ARN)          want="data-$(pascal "${p%_SECRET_ARN}")DbSecretArn" ;;
    *_QUEUE_URL)           want="messaging-$(pascal "${p%_QUEUE_URL}")QueueUrl" ;;
    *_ROLE_ARN)            want="eks-$(pascal "${p%_ROLE_ARN}")RoleArn" ;;
    *)                     want="" ;;
  esac
  if [[ -z "${want}" ]]; then
    fail "<${p}> is not a known deploy-time value and has no export mapping"
  elif has_export "${want}"; then
    ok "<${p}> -> ${want}"
  else
    fail "<${p}> expects export '${want}', which no stack defines"
  fi
done

# ------------------------------------------------- 3. secrets <-> ExternalSecrets
head_ 3 "db-credentials secrets have an ExternalSecret"
DEFINED="$(grep -E '^  name: [a-z-]+-db-credentials$' "${K8S}/10-external-secrets.yaml" | awk '{print $2}' | sort -u)"
USED="$(grep -hE '^\s+name: [a-z-]+-db-credentials$' "${K8S}"/2*.yaml | awk '{print $2}' | sort -u)"
for s in ${USED}; do
  if echo "${DEFINED}" | grep -qx "${s}"; then ok "${s}"; else fail "${s} is read by a Deployment but has no ExternalSecret"; fi
done
for s in ${DEFINED}; do
  if ! echo "${USED}" | grep -qx "${s}"; then fail "${s} has an ExternalSecret but no Deployment reads it"; fi
done

# ------------------------------------------------------------- 4. databases
head_ 4 "RDS instances match services and database names"
RDS_COUNT="$(grep -c 'Type: AWS::RDS::DBInstance' "${STACKS}/04-data.yaml")"
SECRET_COUNT="$(echo "${DEFINED}" | grep -c .)"
if [[ "${RDS_COUNT}" -eq "${SECRET_COUNT}" ]]; then
  ok "${RDS_COUNT} RDS instances, ${SECRET_COUNT} ExternalSecrets"
else
  fail "04-data has ${RDS_COUNT} RDS instances but 10-external-secrets has ${SECRET_COUNT} ExternalSecrets"
fi
DBNAMES="$(grep -E '^\s+DBName: ' "${STACKS}/04-data.yaml" | awk '{print $2}' | sort -u)"
for n in $(grep -hoE ':5432/[a-z_]+' "${K8S}"/2*.yaml | sed 's|:5432/||' | sort -u); do
  if echo "${DBNAMES}" | grep -qx "${n}"; then ok "database ${n}"; else fail "manifest connects to database '${n}' that 04-data does not create"; fi
done

# ------------------------------------------------- 5. services, images, repos
head_ 5 "every service has a manifest image and an ECR repo"
for d in "${ROOT}"/*/; do
  svc="$(basename "${d}")"
  [[ -f "${d}pom.xml" ]] || continue
  img_ok=0; repo_ok=0
  grep -qE "ridenow/${svc}:" "${K8S}"/*.yaml && img_ok=1
  grep -qE "RepositoryName: ridenow/${svc}\$" "${STACKS}/03-ecr.yaml" && repo_ok=1
  if [[ ${img_ok} -eq 1 && ${repo_ok} -eq 1 ]]; then ok "${svc}"; else
    [[ ${img_ok} -eq 0 ]] && fail "${svc}: no ridenow/${svc} image in iac/k8s"
    [[ ${repo_ok} -eq 0 ]] && fail "${svc}: no ECR repo ridenow/${svc} in 03-ecr"
  fi
done

# ------------------------------------------------------------- 6. ingress
head_ 6 "Ingress backends are deployed services"
for b in $(grep -E '^\s+name: [a-z-]+$' "${K8S}/30-ingress.yaml" | awk '{print $2}' | grep -vE '^ridenow$' | sort -u); do
  if grep -qE "ridenow/${b}:" "${K8S}"/*.yaml; then ok "${b}"; else fail "Ingress routes to '${b}' but no manifest deploys it"; fi
done

# ------------------------------------------------------------- 7. params
head_ 7 "params files cover every stack"
for f in "${PARAMS}"/*.json; do
  for layer in 01-iam 02-network 03-ecr 04-data 05-messaging 06-eks-cluster 07-eks-addons 08-frontend; do
    grep -q "\"${layer}\"" "${f}" || fail "$(basename "${f}") has no \"${layer}\" block"
  done
done
[[ ${FAILS} -eq 0 ]] && ok "all params files list all 8 stacks"

# ------------------------------------------------------------- 8. stale links
head_ 8 "no links to the renamed guides"
STALE="$(grep -rnE '0[78]-later-' "${ROOT}/guides" "${ROOT}/docs" "${ROOT}/iac" "${ROOT}/README.md" 2>/dev/null | grep -v 'check-consistency.sh' || true)"
if [[ -z "${STALE}" ]]; then ok "no 07-later-/08-later- references"; else echo "${STALE}"; fail "stale guide links (see above)"; fi

echo
if [[ ${FAILS} -eq 0 ]]; then
  echo "All checks passed."
  exit 0
fi
echo "${FAILS} check(s) failed."
exit 1
