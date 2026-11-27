#!/usr/bin/env bash
# Consistency check for guides/cloudformation/ against iac/stacks/ and iac/params/prod.json.
#
# Read-only: it reads repository files and runs `git ls-files`. It calls no AWS API.
# Every failure prints `<file>:<line>: <message>` and the script exits 1 when any check fails.
#
# Usage (from anywhere):  bash guides/scripts/check-guides.sh
# Needs: bash, awk, grep (with -P), sed, jq, git, find.

set -u

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
GUIDES="$ROOT/guides/cloudformation"
STACKS="$ROOT/iac/stacks"
PARAMS="$ROOT/iac/params/prod.json"
RUNBOOK="$GUIDES/README.md"
TMP="$ROOT/.tmp/check-guides"
mkdir -p "$TMP"
trap 'rm -rf "$TMP"' EXIT

LAYERS=(01-iam 02-network 03-ecr 04-data 05-messaging 06-eks-cluster 07-eks-addons 08-frontend)
REQUIRED_HEADINGS=("What it creates" "Depends on" "Create the resources" "Values to record" "Post-Deploy" "Verify")

FAILS=0
fail() { # $1 file, $2 line, $3 message
  printf 'FAIL %s:%s: %s\n' "${1#"$ROOT"/}" "$2" "$3" >&2
  FAILS=$((FAILS + 1))
}

need() { command -v "$1" >/dev/null 2>&1 || { echo "missing tool: $1" >&2; exit 2; }; }
for T in awk grep sed jq git find; do need "$T"; done

# Strip CR so CRLF checkouts parse the same as LF.
clean() { tr -d '\r' <"$1"; }

# ---- Template parsing --------------------------------------------------------------------

# Top-level keys of a Template section (Resources, Outputs, Parameters).
tpl_keys() { # $1 template, $2 section
  clean "$1" | awk -v sec="$2" '
    /^[A-Za-z]+:/ { insec = ($0 ~ "^" sec ":"); next }
    insec && /^  [A-Za-z0-9]+:[[:space:]]*(#.*)?$/ { k = $1; sub(/:$/, "", k); print k }'
}

# Names of the Fn::ImportValue entries, without the `ridenow-${Environment}-` prefix.
tpl_imports() { # $1 template
  clean "$1" | grep -A1 'ImportValue' | grep 'Fn::Sub' \
    | sed -E 's/.*ridenow-\$\{Environment\}-([A-Za-z0-9-]+)".*/\1/' | sort -u
}

# "<LogicalId><TAB><resolved name>" for resources that carry a fixed name property.
tpl_names() { # $1 template
  clean "$1" | awk '
    /^[A-Za-z]+:/ { insec = ($0 ~ /^Resources:/); next }
    !insec { next }
    /^  [A-Za-z0-9]+:[[:space:]]*(#.*)?$/ { id = $1; sub(/:$/, "", id); next }
    /^      (RoleName|ManagedPolicyName|RepositoryName|DBInstanceIdentifier|TopicName|QueueName|FargateProfileName|ReplicationGroupId|AliasName):/ {
      v = $0; sub(/^      [A-Za-z]+:[[:space:]]*/, "", v)
      sub(/^!Sub[[:space:]]*/, "", v); gsub(/"/, "", v); gsub(/[[:space:]]+$/, "", v)
      gsub(/\$\{Environment\}/, "prod", v)
      if (v != "" && v !~ /\$\{/ && v !~ /^[>|!]/) print id "\t" v
    }'
}

# ---- Guide parsing -----------------------------------------------------------------------

# "<line>:<text>" of every line in the `## <heading>` section of a guide.
section_lines() { # $1 guide, $2 heading
  clean "$1" | awk -v h="$2" '
    /^## / { insec = ($0 ~ "^## " h "[[:space:]]*$"); next }
    insec { print NR ":" $0 }'
}

# Line number of a `## <heading>` line, or empty.
heading_line() { clean "$1" | awk -v h="$2" '$0 ~ "^## " h "[[:space:]]*$" { print NR; exit }'; }

# "<line><TAB>first backticked token of the first cell" for the table rows of a section whose
# header first cell matches the regex.
table_tokens() { # $1 guide, $2 heading, $3 header regex
  clean "$1" | awk -v h="$2" -v hre="$3" '
    /^## / { insec = ($0 ~ "^## " h "[[:space:]]*$"); intab = 0; next }
    !insec { next }
    /^\|/ {
      if (!intab) { intab = 1; rowno = 0; hdr = $0; sub(/^\|[[:space:]]*/, "", hdr); sub(/[[:space:]]*\|.*/, "", hdr); ok = (hdr ~ hre); next }
      rowno++
      if (rowno == 1 && $0 ~ /^\|[-: |]+$/) next
      if (ok) {
        cell = $0; sub(/^\|[[:space:]]*/, "", cell); sub(/[[:space:]]*\|.*/, "", cell)
        if (match(cell, /`[^`]+`/)) print NR "\t" substr(cell, RSTART + 1, RLENGTH - 2)
      }
      next
    }
    { intab = 0 }'
}

# "<line><TAB>param<TAB>value" from `| Parameter | Value |` tables (first backticked token of each cell).
param_rows() { # $1 guide
  clean "$1" | awk '
    /^\|/ {
      if (!intab) { intab = 1; rowno = 0; hdr = $0; ok = (hdr ~ /^\|[[:space:]]*Parameter[[:space:]]*\|[[:space:]]*Value/); next }
      rowno++
      if (rowno == 1 && $0 ~ /^\|[-: |]+$/) next
      if (ok) {
        n = split($0, c, "|")
        a = c[2]; b = c[3]
        if (match(a, /`[^`]+`/)) a = substr(a, RSTART + 1, RLENGTH - 2); else next
        if (match(b, /`[^`]+`/)) b = substr(b, RSTART + 1, RLENGTH - 2); else { gsub(/^[[:space:]]+|[[:space:]]+$/, "", b) }
        print NR "\t" a "\t" b
      }
      next
    }
    { intab = 0 }'
}

# GitHub-style anchors of the headings of a guide.
slugs() {
  clean "$1" | grep -E '^#{1,6} ' | sed -E 's/^#+ +//' | tr 'A-Z' 'a-z' \
    | sed -E 's/[^a-z0-9 _-]//g; s/ /-/g'
}

GUIDE_FILES=("$GUIDES"/*.md)

# ==========================================================================================
# 1. Per layer: resources, outputs, imports, names and parameters against the Template
# ==========================================================================================
for L in "${LAYERS[@]}"; do
  G="$GUIDES/$L.md"
  T="$STACKS/$L.yaml"
  [ -f "$G" ] || { fail "$G" 0 "Resource_Guide is missing"; continue; }
  [ -f "$T" ] || { fail "$T" 0 "Template is missing"; continue; }

  # -- Resources table ------------------------------------------------------------------
  tpl_keys "$T" Resources | sort -u >"$TMP/$L.res"
  table_tokens "$G" "What it creates" '^Template logical ID' >"$TMP/$L.guide-res"
  if [ ! -s "$TMP/$L.guide-res" ]; then
    fail "$G" "$(heading_line "$G" 'What it creates')" "no Resources table (header 'Template logical ID') under 'What it creates'"
  fi
  while IFS=$'\t' read -r LN TOK; do
    grep -qxF "$TOK" "$TMP/$L.res" || fail "$G" "$LN" "guide Resource '$TOK' is not defined in iac/stacks/$L.yaml"
  done <"$TMP/$L.guide-res"
  while read -r RES; do
    cut -f2 "$TMP/$L.guide-res" | grep -qxF "$RES" \
      || fail "$G" "$(heading_line "$G" 'What it creates')" "Template Resource '$RES' is missing from the Resources table"
  done <"$TMP/$L.res"

  # -- Resolved names -------------------------------------------------------------------
  while IFS=$'\t' read -r ID NAME; do
    ROW=$(clean "$G" | awk -v id="\`$ID\`" '/^\|/ && index($0, "| " id " |") == 1 { print NR; exit }')
    [ -n "$ROW" ] || continue
    if ! clean "$G" | sed -n "${ROW}p" | grep -qF "$NAME"; then
      fail "$G" "$ROW" "Resource '$ID' should show the Resolved_Value '$NAME' from $L.yaml"
    fi
  done < <(tpl_names "$T")

  # -- Output_Equivalents ---------------------------------------------------------------
  tpl_keys "$T" Outputs | sort -u >"$TMP/$L.out"
  table_tokens "$G" "Values to record" '^(Output|Template output|Value)' >"$TMP/$L.guide-out"
  VLINE=$(heading_line "$G" 'Values to record')
  while IFS=$'\t' read -r LN TOK; do
    grep -qxF "$TOK" "$TMP/$L.out" || fail "$G" "$LN" "guide Output_Equivalent '$TOK' is not an Output of iac/stacks/$L.yaml"
  done <"$TMP/$L.guide-out"
  while read -r OUT; do
    [ -n "$OUT" ] || continue
    cut -f2 "$TMP/$L.guide-out" | grep -qxF "$OUT" \
      || fail "$G" "${VLINE:-0}" "Template Output '$OUT' has no Output_Equivalent row under 'Values to record'"
  done <"$TMP/$L.out"

  # -- Fn::ImportValue dependencies -----------------------------------------------------
  tpl_imports "$T" >"$TMP/$L.imp"
  section_lines "$G" 'Depends on' >"$TMP/$L.dep"
  DLINE=$(heading_line "$G" 'Depends on')
  grep -oE '`(ridenow-prod-)?(iam|network|messaging|eks|data|ecr)-[A-Z][A-Za-z]+`' "$TMP/$L.dep" 2>/dev/null \
    | tr -d '`' | sed 's/^ridenow-prod-//' | sort -u >"$TMP/$L.guide-imp"
  # line numbers for guide import mentions
  while read -r TOK; do
    [ -n "$TOK" ] || continue
    grep -qxF "$TOK" "$TMP/$L.imp" || {
      LN=$(grep -m1 -F "$TOK" "$TMP/$L.dep" | cut -d: -f1)
      fail "$G" "${LN:-$DLINE}" "guide dependency '$TOK' is not a Fn::ImportValue of iac/stacks/$L.yaml"
    }
  done <"$TMP/$L.guide-imp"
  while read -r IMP; do
    [ -n "$IMP" ] || continue
    # Depends on may name the import token or, in a Value/Created in/Where to find table,
    # the console resource that the import resolves to.
    case "$IMP" in
      network-VpcId) RES='ridenow-prod-vpc' ;;
      network-PrivateSubnetIds) RES='ridenow-prod-private-1' ;;
      network-DbSecurityGroupId) RES='ridenow-prod-db-sg' ;;
      network-NodeSecurityGroupId) RES='ridenow-prod-cluster-sg' ;;
      iam-ClusterRoleArn) RES='ridenow-prod-eks-cluster-role' ;;
      iam-FargatePodExecutionRoleArn) RES='ridenow-prod-eks-fargate-pod-execution-role' ;;
      *) RES='' ;;
    esac
    grep -qxF "$IMP" "$TMP/$L.guide-imp" \
      || { [ -n "$RES" ] && grep -qF "$RES" "$TMP/$L.dep"; } \
      || fail "$G" "${DLINE:-0}" "Fn::ImportValue '$IMP' of $L.yaml is not named under 'Depends on'"
  done <"$TMP/$L.imp"

  # -- Parameter values from prod.json --------------------------------------------------
  while IFS=$'\t' read -r LN P V; do
    ACT=$(jq -r --arg l "$L" --arg k "$P" '.[$l][$k] // "<absent>"' "$PARAMS")
    if [ "$ACT" = "<absent>" ]; then
      fail "$G" "$LN" "parameter '$P' is not in iac/params/prod.json layer $L"
    elif [ "$ACT" != "$V" ]; then
      fail "$G" "$LN" "parameter '$P' is '$V' in the guide but '$ACT' in iac/params/prod.json"
    fi
  done < <(param_rows "$G")
  # every non-trivial value must appear, every empty value must be explained by name
  while IFS=$'\t' read -r P V; do
    case "$P" in Environment|Enable*) continue ;; esac
    if [ -z "$V" ]; then
      grep -qF "$P" "$G" || fail "$G" 0 "prod.json value '$P' is empty and the guide never says how to obtain it"
    elif [ "$V" = true ] || [ "$V" = false ]; then
      # booleans are console checkboxes/radio choices, not typed values
      continue
    else
      grep -qF -- "$V" "$G" || fail "$G" 0 "prod.json value $P='$V' does not appear in the guide"
    fi
  done < <(jq -r --arg l "$L" '.[$l] | to_entries[] | [.key, .value] | @tsv' "$PARAMS")
done

# ==========================================================================================
# 2. Section headings and order
# ==========================================================================================
for L in "${LAYERS[@]}"; do
  G="$GUIDES/$L.md"
  [ -f "$G" ] || continue
  PREV=0
  for H in "${REQUIRED_HEADINGS[@]}"; do
    LN=$(heading_line "$G" "$H")
    if [ -z "$LN" ]; then
      fail "$G" 0 "required heading '## $H' is missing"
    elif [ "$LN" -le "$PREV" ]; then
      fail "$G" "$LN" "heading '## $H' is out of order (expected after line $PREV)"
    else
      PREV=$LN
    fi
  done
done

# ==========================================================================================
# 3. Forbidden content and fence languages (all guides)
# ==========================================================================================
# 08-frontend keeps the template's cloudformation:DescribeStacks statement and its stack ARN.
ALLOW_08=0
grep -q 'cloudformation:DescribeStacks' "$STACKS/08-frontend.yaml" 2>/dev/null && ALLOW_08=1

FORBID='aws cloudformation|list-exports|CAPABILITY_NAMED_IAM|ROLLBACK_COMPLETE'
FORBID="$FORBID|(^|[^A-Za-z0-9-])ridenow-(prod|\\\$ENV|\\\$\\{ENV\\})-(01-|02-|03-|04-|05-|06-|07-|08-)?(iam|network|ecr|data|messaging|eks-cluster|eks-addons|frontend)(\$|[^A-Za-z0-9-])"
FORBID="$FORBID|env\\.sh|cfn_deploy|k8s_apply|stack_status|stack_failures|stack_outputs"
FORBID="$FORBID|(^|[^A-Za-z0-9_-])(exp|params)[[:space:]]+[\"'\$]|\\\$\\((exp|params)[[:space:]]"

for F in "${GUIDE_FILES[@]}"; do
  [ -f "$F" ] || continue
  while IFS= read -r HIT; do
    LN=${HIT%%:*}
    TXT=${HIT#*:}
    if [ "$ALLOW_08" = 1 ] && [ "$(basename "$F")" = "08-frontend.md" ] \
       && printf '%s' "$TXT" | grep -qE '"Resource": "arn:aws:cloudformation:[a-z0-9-]+:[0-9]+:stack/ridenow-prod-08-frontend/\*"'; then
      continue
    fi
    fail "$F" "$LN" "forbidden content: $(printf '%s' "$TXT" | grep -oE "$FORBID" | head -1 | sed 's/^[^A-Za-z]*//')"
  done < <(clean "$F" | grep -nE "$FORBID")

  # Fence languages: command fences must be bash. json, yaml, text and javascript are data fences.
  clean "$F" | awk '
    /^[[:space:]]*```/ {
      if (!open) { open = 1; l = $0; sub(/^[[:space:]]*```/, "", l); gsub(/[[:space:]]/, "", l); print NR "\t" l }
      else open = 0
    }' | while IFS=$'\t' read -r LN LANG; do
    case "$LANG" in
      bash | json | yaml | text | javascript) ;;
      "") fail "$F" "$LN" "code fence has no language (use bash for commands)" ;;
      *) fail "$F" "$LN" "code fence language '$LANG' is not allowed (command fences must be bash)" ;;
    esac
  done
done

# ==========================================================================================
# 4. Discovery_Block: exactly one bash block in the Runbook, repeated by no guide
# ==========================================================================================
if [ ! -f "$RUNBOOK" ]; then
  fail "$RUNBOOK" 0 "Runbook is missing"
else
  DB_HEAD=$(heading_line "$RUNBOOK" 'Discovery_Block.*')
  if [ -z "$DB_HEAD" ]; then
    fail "$RUNBOOK" 0 "no '## Discovery_Block' heading"
  else
    DB_SEC=$(clean "$RUNBOOK" | awk '
      /^## / { insec = ($0 ~ /^## Discovery_Block/); next }
      insec { print }')
    NB=$(printf '%s\n' "$DB_SEC" | grep -cE '^[[:space:]]*```bash[[:space:]]*$')
    [ "$NB" -eq 1 ] || fail "$RUNBOOK" "$DB_HEAD" "Discovery_Block section has $NB bash blocks, expected exactly 1"
    # the block body, trimmed; keep distinctive lines only
    printf '%s\n' "$DB_SEC" | awk '/^[[:space:]]*```bash/ { b = 1; next } /^[[:space:]]*```/ { b = 0 } b' \
      | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//' | grep -vE '^#' | awk 'length($0) >= 40' | sort -u >"$TMP/db.lines"
    [ -s "$TMP/db.lines" ] || fail "$RUNBOOK" "$DB_HEAD" "Discovery_Block bash block is empty"
    for F in "${GUIDE_FILES[@]}"; do
      [ -f "$F" ] || continue
      if [ "$F" = "$RUNBOOK" ]; then
        clean "$F" | awk '/^## / { skip = ($0 ~ /^## Discovery_Block/) } !skip' >"$TMP/other.txt"
      else
        clean "$F" >"$TMP/other.txt"
      fi
      N=$(sed -E 's/^[[:space:]]+//' "$TMP/other.txt" | grep -cFxf "$TMP/db.lines")
      [ "$N" -lt 3 ] || fail "$F" 0 "repeats $N lines of the Discovery_Block; guides must not repeat it"
    done
  fi
fi

# ==========================================================================================
# 5. Repository state: env.sh references, root .sh/.log files
# ==========================================================================================
cd "$ROOT" || exit 2
ENVSH='env\.s[h]'
while IFS= read -r F; do
  [ -f "$F" ] || continue
  case "$F" in .git/* | .scratch/* | .tmp/* | guides/scripts/check-guides.sh) continue ;; esac
  while IFS= read -r HIT; do
    fail "$ROOT/$F" "${HIT%%:*}" "references the removed helper file"
  done < <(grep -nI -E "$ENVSH" "$F")
done < <(git -c safe.directory='*' ls-files)

while IFS= read -r F; do
  fail "$F" 0 ".sh or .log file in the repo root (move scripts to iac/scripts or guides/scripts, logs to .tmp)"
done < <(find "$ROOT" -maxdepth 1 -type f \( -name '*.sh' -o -name '*.log' \))

# ==========================================================================================
# 6. Referenced repository paths and guide links
# ==========================================================================================
PATH_RE='(^|[^A-Za-z0-9_./$<{-])((iac|guides|docs|frontend|scripts|localstack|\.github|(user|driver|trip|payment|matching)-service|notification-worker|realtime-gateway)/[A-Za-z0-9_./-]*[A-Za-z0-9_])'
for F in "${GUIDE_FILES[@]}"; do
  [ -f "$F" ] || continue
  # repository paths
  while IFS= read -r HIT; do
    LN=${HIT%%:*}
    P=${HIT#*:}
    # a path followed by `<`, `*` or `$` is a pattern, not a file
    [ -e "$ROOT/$P" ] || fail "$F" "$LN" "referenced repository path '$P' does not exist"
  done < <(clean "$F" | grep -noP "$PATH_RE(?![A-Za-z0-9_./-]*[<*\$])" | sed -E 's/^([0-9]+):[^A-Za-z0-9]?/\1:/' \
           | awk -F: '{ ln = $1; p = $0; sub(/^[0-9]+:/, "", p); print ln ":" p }')

  # markdown links
  while IFS= read -r HIT; do
    LN=${HIT%%:*}
    TGT=${HIT#*:}
    case "$TGT" in http*) continue ;; esac
    FILEPART=${TGT%%#*}
    ANCHOR=""
    case "$TGT" in *'#'*) ANCHOR=${TGT#*#} ;; esac
    if [ -z "$FILEPART" ]; then
      DEST="$F"
    else
      DEST=$(cd "$(dirname "$F")" && realpath -m "$FILEPART")
      case "$DEST" in
        "$GUIDES"/*.md) ;;
        *) fail "$F" "$LN" "link '$TGT' points outside guides/cloudformation/" ; continue ;;
      esac
      [ -f "$DEST" ] || { fail "$F" "$LN" "linked guide '$FILEPART' does not exist"; continue; }
    fi
    if [ -n "$ANCHOR" ] && ! slugs "$DEST" | grep -qxF "$ANCHOR"; then
      fail "$F" "$LN" "anchor '#$ANCHOR' not found in $(basename "$DEST")"
    fi
  done < <(clean "$F" | grep -noP '\]\(\K[^)\s]+(?=\))')

  # bare mentions of numbered guides such as 06a-observability.md
  while IFS= read -r HIT; do
    LN=${HIT%%:*}
    NAME=${HIT#*:}
    [ -f "$GUIDES/$NAME" ] || fail "$F" "$LN" "mentions guide '$NAME', which is not in guides/cloudformation/"
  done < <(clean "$F" | grep -noP '(?<![A-Za-z0-9_/.-])[0-9]{2}[a-z]?-[a-z0-9-]+\.md')
done

# ==========================================================================================
if [ "$FAILS" -gt 0 ]; then
  echo "check-guides: $FAILS failure(s)" >&2
  exit 1
fi
echo "check-guides: OK (${#LAYERS[@]} Resource_Guides, Runbook, repository state)"
