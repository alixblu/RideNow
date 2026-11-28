#!/usr/bin/env bash
# Checks the X-Ray tracing guide (task 10.4, requirements 6.1, 6.2, 6.7, 6.8).
# Usage: bash guides/scripts/check-xray-guide.sh
# Prints PASS/FAIL lines and exits non-zero if any check fails.

set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GUIDE="$ROOT/guides/cloudformation/09-xray-tracing.md"
README="$ROOT/guides/cloudformation/README.md"
FAILS=0

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; FAILS=$((FAILS + 1)); }

# check_heading <label> <extended regex matched against heading lines>
check_heading() {
  if grep -Eiq "^#{1,6} +$2" "$GUIDE"; then
    pass "guide has heading: $1"
  else
    fail "guide is missing heading: $1"
  fi
}

if [ ! -f "$GUIDE" ]; then
  fail "guide not found: guides/cloudformation/09-xray-tracing.md"
else
  pass "guide exists"
  check_heading "What it creates" "What it creates"
  check_heading "Depends on" "Depends on"
  check_heading "Use X-Ray section" ".*Use X-Ray"
  check_heading "Troubleshooting" "Troubleshooting"
  check_heading "Scenarios" "(.*scenarios|Scenario [0-9])"
  n=$(grep -Eic '^#{1,6} +Scenario [0-9]' "$GUIDE")
  if [ "$n" -ge 4 ]; then
    pass "guide has $n scenario headings (>= 4)"
  else
    fail "guide has $n scenario headings (need >= 4)"
  fi
fi

if [ ! -f "$README" ]; then
  fail "README not found: guides/cloudformation/README.md"
elif grep -q '09-xray-tracing\.md' "$README"; then
  pass "README lists 09-xray-tracing.md"
else
  fail "README does not list 09-xray-tracing.md"
fi

bad=$(find "$ROOT" -maxdepth 1 -type f \( -name '*.sh' -o -name '*.log' \) 2>/dev/null)
if [ -z "$bad" ]; then
  pass "no .sh or .log files in the repo root"
else
  fail "forbidden files in the repo root: $(echo "$bad" | tr '\n' ' ')"
fi

if [ "$FAILS" -gt 0 ]; then
  echo "RESULT: FAIL ($FAILS check(s) failed)"
  exit 1
fi
echo "RESULT: PASS"
