#!/usr/bin/env bash
# Property 1: Params lookup returns the exact stored value or empty, never a wrong value.
# Validates: Requirements 6.5, 6.10
# Property 2: Params lookup is idempotent (two calls, same args and file => same result).
# Validates: Requirements 6.9
# Extracts param() from the Discovery_Block in 00-deploy-runbook.md and checks it
# against randomly generated {layer:{key:value}} fixtures (>= 100 iterations).
set -u

ITERATIONS="${ITERATIONS:-150}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
RUNBOOK="$ROOT/guides/cloudformation/00-deploy-runbook.md"

command -v jq >/dev/null || { echo "jq is required"; exit 2; }

# Extract the param() definition (single line) from the Discovery_Block.
FUNC_LINE="$(grep -E '^param\(\) \{' "$RUNBOOK" | head -n1)"
[ -n "$FUNC_LINE" ] || { echo "FAIL: param() not found in $RUNBOOK"; exit 1; }

WORK="$ROOT/.tmp/test-discovery.$$"
mkdir -p "$WORK/iac/params"
trap 'rm -rf "$WORK"' EXIT
cd "$WORK" || exit 1   # param() reads relative iac/params/prod.json
eval "$FUNC_LINE"

LAYERS=(iam network ecr data messaging eks frontend)
KEYS=(VpcCidr DbName Env Region ClusterName Domain BucketName Cert)
VALUES=("us-east-1" "10.0.0.0/16" "prod" "with space" "a\"quote" 'back\slash' "x=y" "ünï" "0" "true" "")

fail=0
p2_checked=0
for ((i = 1; i <= ITERATIONS; i++)); do
  # Random fixture: each layer present with ~70% prob, each key present ~50%.
  json='{}'
  declare -A stored=()
  for l in "${LAYERS[@]}"; do
    (( RANDOM % 10 < 7 )) || continue
    json="$(jq -c --arg l "$l" '.[$l] = {}' <<<"$json")"
    for k in "${KEYS[@]}"; do
      (( RANDOM % 2 )) || continue
      v="${VALUES[RANDOM % ${#VALUES[@]}]}"
      json="$(jq -c --arg l "$l" --arg k "$k" --arg v "$v" '.[$l][$k] = $v' <<<"$json")"
      stored["$l/$k"]="$v"
    done
  done
  printf '%s' "$json" > iac/params/prod.json

  # Query a random layer/key (may be absent, or a layer that was never generated).
  ql="${LAYERS[RANDOM % ${#LAYERS[@]}]}"
  qk="${KEYS[RANDOM % ${#KEYS[@]}]}"
  got="$(param "$ql" "$qk")"
  # Property 2: a second call with identical args and file content returns the same string.
  got2="$(param "$ql" "$qk")"
  if [ "$got" != "$got2" ]; then
    echo "FAIL Property 2 iter $i: param $ql $qk => [$got] then [$got2]"
    echo "fixture: $json"
    fail=1
    break
  fi
  p2_checked=$((p2_checked + 1))
  if [[ -v stored["$ql/$qk"] ]]; then expected="${stored["$ql/$qk"]}"; else expected=""; fi
  if [ "$got" != "$expected" ]; then
    echo "FAIL iter $i: param $ql $qk => [$got], expected [$expected]"
    echo "fixture: $json"
    fail=1
    break
  fi
  unset stored
done

# Missing file must also yield empty and not error out.
rm -f iac/params/prod.json
[ -z "$(param iam VpcCidr)" ] || { echo "FAIL: missing file should yield empty"; fail=1; }

# ---------------------------------------------------------------------------
# Property 3: Discovery lookups never mutate AWS state and never abort the shell.
# Validates: Requirements 6.3, 6.6, 6.9, 6.10
# Runs the whole Discovery_Block with a stub `aws` that logs "<service> <subcommand>"
# and randomly reports each resource as present or absent (value, "None", empty, or
# non-zero exit). Asserts: every logged subcommand is describe-/list-/get- only,
# no `cloudformation` service call, and the sourcing shell reaches the end.
# ---------------------------------------------------------------------------
BLOCK_FILE="$WORK/discovery-block.sh"
awk '
  /^## Discovery_Block/ { in_sec = 1; next }
  in_sec && /^```bash/ && !in_blk { in_blk = 1; next }
  in_blk && /^```/ { exit }
  in_blk { print }
' "$RUNBOOK" > "$BLOCK_FILE"
[ -s "$BLOCK_FILE" ] || { echo "FAIL: Discovery_Block not found in $RUNBOOK"; exit 1; }
[ "$(grep -c '^## Discovery_Block' "$RUNBOOK")" -eq 1 ] || { echo "FAIL: expected exactly one Discovery_Block heading"; exit 1; }

STUBS="$WORK/stubs"
mkdir -p "$STUBS"
cat > "$STUBS/aws" <<'EOF'
#!/usr/bin/env bash
# Stub aws: log "<service> <subcommand>", then answer randomly.
echo "$1 $2" >> "$STUB_LOG"
case $((RANDOM % 5)) in
  0|1) echo "present-value other-value"; exit 0 ;;   # resource present
  2)   echo "None"; exit 0 ;;                          # CLI "not found" text output
  3)   exit 254 ;;                                     # absent: error, no output
  4)   echo "An error occurred (ResourceNotFound)" >&2; exit 255 ;;
esac
EOF
# Other tools the block (or a future edit of it) might touch: log and succeed.
for t in kubectl helm eksctl docker; do
  printf '#!/usr/bin/env bash\necho "%s $*" >> "$STUB_LOG"\nexit 0\n' "$t" > "$STUBS/$t"
done
chmod +x "$STUBS"/*

p3_fail=0
for ((i = 1; i <= ITERATIONS; i++)); do
  export STUB_LOG="$WORK/aws-calls.$i.log"
  : > "$STUB_LOG"
  # Randomly present or missing params file.
  if (( RANDOM % 2 )); then
    printf '{"04-data":{"DbInstanceClass":"db.t3.micro"}}' > iac/params/prod.json
  else
    rm -f iac/params/prod.json
  fi
  out="$(PATH="$STUBS:$PATH" bash -c 'source "$1"; echo "__SURVIVED__ rc=$?"' _ "$BLOCK_FILE" 2>&1)"
  if ! grep -q '^__SURVIVED__' <<<"$out"; then
    echo "FAIL Property 3 iter $i: shell did not survive the Discovery_Block"
    echo "$out" | tail -n 5
    p3_fail=1; break
  fi
  if ! grep -q '^ENV=prod ' <<<"$out"; then
    echo "FAIL Property 3 iter $i: block did not reach the summary header"
    p3_fail=1; break
  fi
  if [ ! -s "$STUB_LOG" ]; then
    echo "FAIL Property 3 iter $i: stub log empty (stub not used)"
    p3_fail=1; break
  fi
  bad="$(awk '$1 == "cloudformation" || $2 !~ /^(describe|list|get)-/' "$STUB_LOG" | head -n 3)"
  if [ -n "$bad" ]; then
    echo "FAIL Property 3 iter $i: non-read-only AWS call(s):"
    echo "$bad"
    p3_fail=1; break
  fi
  if grep -Eq '(^| )(create-|update-|delete-|put-|apply|cloudformation)' "$STUB_LOG"; then
    echo "FAIL Property 3 iter $i: forbidden subcommand in log"
    p3_fail=1; break
  fi
  rm -f "$STUB_LOG"
done
[ "$p3_fail" -eq 0 ] || fail=1

if [ "$fail" -eq 0 ]; then
  echo "PASS Property 1: param() exact-or-empty over $ITERATIONS iterations"
  echo "PASS Property 2: param() idempotent over $p2_checked iterations"
  echo "PASS Property 3: Discovery_Block read-only and non-aborting over $ITERATIONS iterations"
  exit 0
fi
exit 1
