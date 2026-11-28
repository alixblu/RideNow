#!/usr/bin/env bash
#
# check-otel-env.sh - static checks for the OpenTelemetry env vars in the
# service manifests iac/k8s/20-*.yaml to 26-*.yaml (xray-tracing spec).
#
# Per manifest: JAVA_TOOL_OPTIONS attaches the agent, OTEL_SERVICE_NAME equals
# the service name (file name without the NN- prefix), OTLP endpoint and
# protocol, propagators, sampler and arg, metrics/logs exporter "none".
# Every service must also set OTEL_INSTRUMENTATION_SPRING_SCHEDULING_ENABLED,
# OTEL_INSTRUMENTATION_SPRING_DATA_ENABLED and OTEL_INSTRUMENTATION_HIBERNATE_ENABLED
# to "false" (no method-level noise nodes in the service map).
# Prints PASS/FAIL per check and exits non-zero if any check fails.
#
# Usage: iac/scripts/check-otel-env.sh [k8s-dir]

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
K8S_DIR="${1:-$SCRIPT_DIR/../k8s}"
FAILED=0

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; FAILED=1; }

# Print the value of env var $2 in manifest $1 (empty if missing).
env_value() {
  sed -e 's/\r$//' -e 's/^[[:space:]]*#.*$//' "$1" | awk -v want="$2" '
    /^[[:space:]]*-[[:space:]]*name:[[:space:]]*/ {
      n = $0; sub(/^[[:space:]]*-[[:space:]]*name:[[:space:]]*/, "", n)
      gsub(/["[:space:]]/, "", n); cur = n; next }
    /^[[:space:]]*value:[[:space:]]*/ && cur == want {
      v = $0; sub(/^[[:space:]]*value:[[:space:]]*/, "", v)
      sub(/[[:space:]]+#.*$/, "", v); gsub(/^"|"$/, "", v)
      print v; exit }'
}

# check_eq <label> <service> <manifest> <var> <expected>
check_eq() {
  local got
  got="$(env_value "$3" "$4")"
  if [ "$got" = "$5" ]; then
    pass "$2: $4 = $5"
  else
    fail "$2: $4 expected '$5', found '${got:-missing}'"
  fi
}

shopt -s nullglob
FILES=("$K8S_DIR"/2[0-6]-*.yaml)
if [ "${#FILES[@]}" -ne 7 ]; then
  fail "expected 7 manifests 20-*.yaml to 26-*.yaml, found ${#FILES[@]} in $K8S_DIR"
fi

for f in "${FILES[@]}"; do
  base="$(basename "$f" .yaml)"
  svc="${base#??-}"

  check_eq x "$svc" "$f" JAVA_TOOL_OPTIONS "-javaagent:/opt/otel/opentelemetry-javaagent.jar"
  check_eq x "$svc" "$f" OTEL_SERVICE_NAME "$svc"
  check_eq x "$svc" "$f" OTEL_EXPORTER_OTLP_ENDPOINT "http://adot-collector.ridenow.svc.cluster.local:4317"
  check_eq x "$svc" "$f" OTEL_EXPORTER_OTLP_PROTOCOL "grpc"
  check_eq x "$svc" "$f" OTEL_PROPAGATORS "xray,tracecontext,baggage"
  check_eq x "$svc" "$f" OTEL_TRACES_SAMPLER "parentbased_traceidratio"
  check_eq x "$svc" "$f" OTEL_TRACES_SAMPLER_ARG "1.0"
  check_eq x "$svc" "$f" OTEL_METRICS_EXPORTER "none"
  check_eq x "$svc" "$f" OTEL_LOGS_EXPORTER "none"

  check_eq x "$svc" "$f" OTEL_INSTRUMENTATION_SPRING_SCHEDULING_ENABLED "false"
  check_eq x "$svc" "$f" OTEL_INSTRUMENTATION_SPRING_DATA_ENABLED "false"
  check_eq x "$svc" "$f" OTEL_INSTRUMENTATION_HIBERNATE_ENABLED "false"
done

if [ "$FAILED" -ne 0 ]; then
  echo "RESULT: FAIL"
  exit 1
fi
echo "RESULT: PASS"
