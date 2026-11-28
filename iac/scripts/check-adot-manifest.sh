#!/usr/bin/env bash
#
# check-adot-manifest.sh - static checks for iac/k8s/15-adot-collector.yaml.
#
# Checks: no DaemonSet or hostPath (Fargate), Service is ClusterIP with ports
# 4317 and 4318, Deployment replicas >= 2, no hard-coded 12-digit account ids.
# Prints PASS/FAIL per check and exits non-zero if any check fails.
#
# Usage: iac/scripts/check-adot-manifest.sh [path-to-manifest]

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFEST="${1:-$SCRIPT_DIR/../k8s/15-adot-collector.yaml}"
FAILED=0

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; FAILED=1; }

if [ ! -f "$MANIFEST" ]; then
  echo "FAIL: manifest not found: $MANIFEST"
  exit 1
fi

# Manifest without comment lines and trailing comments, CRLF removed.
CODE="$(sed -e 's/\r$//' -e 's/^[[:space:]]*#.*$//' -e 's/[[:space:]]#.*$//' "$MANIFEST")"

# Document of a given kind (documents are separated by '---').
doc_of_kind() {
  printf '%s\n' "$CODE" | awk -v kind="$1" '
    function flush() { if (buf ~ ("(^|\n)kind:[ ]*" kind "([ ]|\n|$)")) printf "%s", buf; buf = "" }
    /^---[ ]*$/ { flush(); next }
    { buf = buf $0 "\n" }
    END { flush() }'
}

# 1. No DaemonSet
if printf '%s\n' "$CODE" | grep -Eq '^kind:[[:space:]]*DaemonSet'; then
  fail "no DaemonSet (found kind: DaemonSet)"
else
  pass "no DaemonSet"
fi

# 2. No hostPath
if printf '%s\n' "$CODE" | grep -q 'hostPath'; then
  fail "no hostPath (found hostPath volume)"
else
  pass "no hostPath"
fi

# 3. Service ClusterIP with ports 4317 and 4318
SVC="$(doc_of_kind Service)"
if [ -z "$SVC" ]; then
  fail "Service present"
else
  if printf '%s\n' "$SVC" | grep -Eq '^[[:space:]]+type:[[:space:]]*"?ClusterIP"?[[:space:]]*$'; then
    pass "Service type is ClusterIP"
  else
    fail "Service type is ClusterIP"
  fi
  for p in 4317 4318; do
    if printf '%s\n' "$SVC" | grep -Eq "^[[:space:]]+-?[[:space:]]*port:[[:space:]]*$p[[:space:]]*$"; then
      pass "Service exposes port $p"
    else
      fail "Service exposes port $p"
    fi
  done
fi

# 4. Deployment replicas >= 2
REPLICAS="$(doc_of_kind Deployment | sed -n 's/^[[:space:]]*replicas:[[:space:]]*"\{0,1\}\([0-9]\{1,\}\)"\{0,1\}[[:space:]]*$/\1/p' | head -n1)"
if [ -n "$REPLICAS" ] && [ "$REPLICAS" -ge 2 ]; then
  pass "Deployment replicas >= 2 (replicas: $REPLICAS)"
else
  fail "Deployment replicas >= 2 (found: ${REPLICAS:-none})"
fi

# 5. No hard-coded 12-digit account ids (checked on the raw file, comments included)
if grep -Eq '(^|[^0-9])[0-9]{12}([^0-9]|$)' "$MANIFEST"; then
  fail "no hard-coded 12-digit account id"
  grep -En '(^|[^0-9])[0-9]{12}([^0-9]|$)' "$MANIFEST" | sed 's/^/      /'
else
  pass "no hard-coded 12-digit account id"
fi

if [ "$FAILED" -ne 0 ]; then
  echo "RESULT: FAIL"
  exit 1
fi
echo "RESULT: PASS"
