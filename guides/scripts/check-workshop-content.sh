#!/usr/bin/env bash
# Verification of the Workshop and Proposal content (design component 12, requirements 11, 12, 15, 16, 17).
#
# Read-only apart from the log and a scratch directory under .tmp/. It calls no AWS API.
# Every violation prints `FAIL [<category>] <file>:<line>: <message>`. All violations of all ten
# categories are reported in one run, then the script exits 1 when there is at least one.
#
# Categories:
#   1 parity          heading parity between _index.md and _index.vi.md (landing page and 5.1 to 5.11)
#   2 coverage        every Resource_Name of a Source_Guide "What it creates" table is on the page, both languages
#   3 forbidden       forbidden terms in the Workshop_Chapter
#   4 links           internal links and images of the Workshop_Chapter resolve
#   5 dangling        references to the deleted Runbook, `5.12`, `Discovery_Block`, and broken Markdown
#                     links/anchors in guides/, docs/, iac/README.md, .kiro/specs/
#   6 placeholders    Placeholder rules and Author_Value rules (requirement 16)
#   7 auto-variables  Auto_Variable rules (requirement 17)
#   8 structure       folders 5.1 to 5.11, weight, pre, table of contents
#   9 bash-identity   Bash blocks identical across languages, same variable and Placeholder names
#  10 hugo-build      `hugo` exits 0 with no ERROR output
#
# Conventions the checks rely on:
#   - A fenced block with language `bash` is a command block. Every other fence (`text`, `json`, ...)
#     counts as an "expected result"/data block.
#   - A Copy_Instruction is a prose line (or table row) that holds the `<PLACEHOLDER>` and either names a
#     Section_Page (`5.N`) or says copy / console (Vietnamese: sao chép / bảng điều khiển). It must come
#     at or before the first command block that uses the Placeholder.
#   - A Variable_Home_Page is the first page (5.1 to 5.11 order) that assigns the variable. Later pages
#     restate the assignment, and its right-hand side must be the same text.
#
# Usage (from anywhere):  bash guides/scripts/check-workshop-content.sh
# Needs: bash, awk, grep (with -P), sed, git, find, realpath, diff, sort, hugo (or hugo.exe).

set -u

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
SITE="$ROOT/fcj-workshop-ridenow"
CH="$SITE/content/5-Workshop"
STATIC="$SITE/static"
LOG="$ROOT/.tmp/check-workshop-content.log"
mkdir -p "$ROOT/.tmp"
# One scratch dir per run, so two runs at the same time cannot delete each other's files.
# It is removed only after the summary has been counted (no EXIT trap: an early cleanup hid violations).
TMP=$(mktemp -d "$ROOT/.tmp/check-workshop-content.XXXXXX")
CLS="$TMP/cls"
VARS="$TMP/vars"
# The violation list lives outside the scratch dir, so cleaning the scratch dir can never hide a violation.
VIOL="$TMP.violations"

mkdir -p "$CLS" "$VARS"
: >"$LOG"
: >"$VIOL"

KEYS="L 1 2 3 4 5 6 7 8 9 10 11"
CATS=(parity coverage forbidden links dangling placeholders auto-variables structure bash-identity hugo-build)

declare -A GUIDE_OF=([3]=01-iam [4]=02-network [5]=03-ecr [6]=04-data [7]=05-messaging [8]=06-eks-cluster [9]=07-eks-addons [10]=08-frontend)

need() { command -v "$1" >/dev/null 2>&1 || { echo "missing tool: $1" >&2; exit 2; }; }
for T in awk grep sed git find realpath diff sort; do need "$T"; done

say() { printf '%s\n' "$*" | tee -a "$LOG"; }

vio() { # $1 category, $2 file, $3 line, $4 message
  local rel=${2#"$ROOT"/}
  rel=${rel#"$SITE"/}
  printf 'FAIL [%s] %s:%s: %s\n' "$1" "$rel" "$3" "$4" | tee -a "$LOG" >&2
  printf '%s\n' "$1" >>"$VIOL"
}

# Strip CR so CRLF checkouts parse the same as LF.
clean() { tr -d '\r' <"$1"; }

# ---- Awk programs ------------------------------------------------------------------------

# Classifier: "<line>\t<kind>\t<block id>\t<text>". Kinds: P prose, B bash fence content,
# X other fence content, F a fence line (text is `open:<lang>` or `close`).
cat >"$TMP/classify.awk" <<'AWK'
BEGIN { OFS = "\t"; open = 0; bid = 0 }
{
  line = $0
  sub(/\r$/, "", line)
  if (line ~ /^[ \t]*(```|~~~)/) {
    if (!open) {
      open = 1; bid++
      l = line
      sub(/^[ \t]*(```|~~~)[ \t]*/, "", l)
      sub(/[ \t].*$/, "", l)
      kind = (l == "bash") ? "B" : "X"
      print NR, "F", bid, "open:" l
    } else {
      open = 0
      print NR, "F", bid, "close"
    }
    next
  }
  if (open) print NR, kind, bid, line
  else print NR, "P", 0, line
}
AWK

# Heading signature of a classified file: "<line>\t<level>|<number prefix>|<inline code tokens>".
cat >"$TMP/headsig.awk" <<'AWK'
BEGIN { FS = "\t" }
$2 == "P" {
  t = $0; sub(/^[^\t]*\t[^\t]*\t[^\t]*\t/, "", t)
  if (t ~ /^#+[ \t]/) {
    h = t; lvl = 0
    while (substr(h, 1, 1) == "#") { lvl++; h = substr(h, 2) }
    sub(/^[ \t]+/, "", h)
    num = ""
    if (match(h, /^[0-9]+(\.[0-9]+)*\.?/)) num = substr(h, 1, RLENGTH)
    code = ""; s = h
    while (match(s, /`[^`]+`/)) { code = code substr(s, RSTART, RLENGTH); s = substr(s, RSTART + RLENGTH) }
    print $1 "\t" lvl "|" num "|" code
  }
}
AWK

# Link extraction from "<line>\t<prose>" input: "<line>\t<1 if image>\t<target>".
cat >"$TMP/links.awk" <<'AWK'
BEGIN { FS = "\t" }
{
  ln = $1; s = $0; sub(/^[^\t]*\t/, "", s)
  while (match(s, /!?\[[^]]*\]\([^) \t]+/)) {
    m = substr(s, RSTART, RLENGTH); s = substr(s, RSTART + RLENGTH)
    img = (substr(m, 1, 1) == "!") ? 1 : 0
    sub(/^!?\[[^]]*\]\(/, "", m)
    print ln "\t" img "\t" m
  }
  s = $0; sub(/^[^\t]*\t/, "", s)
  while (match(s, /<img[^>]*src="[^"]+"/)) {
    m = substr(s, RSTART, RLENGTH); s = substr(s, RSTART + RLENGTH)
    sub(/^.*src="/, "", m); sub(/"$/, "", m)
    print ln "\t" 1 "\t" m
  }
}
AWK

# Auto_Variable analysis of the Bash blocks of one page. Emits `ERR\t<line>\t<msg>` and
# `DEF\t<line>\t<name>\t<right-hand side>`.
cat >"$TMP/vars.awk" <<'AWK'
BEGIN { FS = "\t"; OK = " HOME PATH PWD USER SHELL HOSTNAME RANDOM OLDPWD LINENO BASH_SOURCE "; cont = 0; hd = ""; lastbid = -1 }
function trim(s) { gsub(/^[ \t]+/, "", s); gsub(/[ \t]+$/, "", s); return s }
$2 == "B" {
  ln = $1; bid = $3
  line = $0; sub(/^[^\t]*\t[^\t]*\t[^\t]*\t/, "", line)
  if (bid != lastbid) { lastbid = bid; cont = 0; hd = "" }
  if (hd != "") { if (trim(line) == hd) hd = ""; next }
  if (line ~ /^[ \t]*#/) { cont = 0; next }
  iscont = cont
  cont = (line ~ /\\[ \t]*$/) ? 1 : 0
  if (match(line, /<<-?[ \t]*['"][A-Za-z_][A-Za-z0-9_]*['"]/)) {
    t = substr(line, RSTART, RLENGTH)
    gsub(/<<-?[ \t]*['"]/, "", t); gsub(/['"]/, "", t)
    hd = t
  }
  work = line
  gsub(/\\\$/, "", work)
  gsub(/'[^']*'/, "", work)
  sub(/[ \t]#.*$/, "", work)
  # uses
  w = work
  while (match(w, /\$\{?[A-Za-z_][A-Za-z0-9_]*/)) {
    n = substr(w, RSTART, RLENGTH); sub(/^\$\{?/, "", n)
    w = substr(w, RSTART + RLENGTH)
    if (!(n in D) && index(OK, " " n " ") == 0)
      print "ERR\t" ln "\tvariable $" n " is used before it is defined on this page"
  }
  # loop variables
  if (match(work, /(^|[ \t;&|(])for[ \t]+[A-Za-z_][A-Za-z0-9_]*[ \t]+in[ \t]/)) {
    t = substr(work, RSTART, RLENGTH)
    sub(/^.*for[ \t]+/, "", t); sub(/[ \t]+in[ \t]$/, "", t)
    D[t] = 1
  }
  if (match(work, /(^|[ \t;&|(])read[ \t]+[^;|&]*/)) {
    t = substr(work, RSTART, RLENGTH); sub(/^.*read[ \t]+/, "", t)
    nw = split(t, ws, /[ \t]+/)
    for (i = 1; i <= nw; i++) if (ws[i] ~ /^[A-Za-z_][A-Za-z0-9_]*$/) D[ws[i]] = 1
  }
  # assignments
  if (!iscont) {
    np = split(line, parts, /;|&&|\|\|/)
    for (i = 1; i <= np; i++) {
      p = parts[i]
      sub(/^[ \t]*(do|then|else)[ \t]+/, "", p)
      sub(/^[ \t]*[({][ \t]*/, "", p)
      sub(/^[ \t]*(export|local|readonly|declare|typeset)[ \t]+(-[A-Za-z]+[ \t]+)*/, "", p)
      if (match(p, /^[ \t]*[A-Za-z_][A-Za-z0-9_]*=/)) {
        nm = substr(p, RSTART, RLENGTH - 1); gsub(/[ \t]/, "", nm)
        rhs = trim(substr(p, RSTART + RLENGTH)); sub(/[ \t]*\\$/, "", rhs)
        if (nm !~ /^[A-Z][A-Z0-9_]*$/) print "ERR\t" ln "\tvariable " nm " is not UPPER_SNAKE_CASE"
        D[nm] = 1
        print "DEF\t" ln "\t" nm "\t" rhs
      }
    }
  }
}
AWK

# Placeholder analysis of one page: `<line>\t<message>`.
cat >"$TMP/ph.awk" <<'AWK'
BEGIN { FS = "\t"; tags = " BR B I P UL OL LI TD TR TH TABLE DIV SPAN CODE PRE EM " }
$2 == "F" { next }
{
  ln = $1; kind = $2
  txt = $0; sub(/^[^\t]*\t[^\t]*\t[^\t]*\t/, "", txt)
  if (kind == "B" && txt ~ /^[ \t]*#/) next
  s = txt
  qual = (kind == "P" && (txt ~ /5\.[0-9]/ || tolower(txt) ~ /copy|sao chép|console|bảng điều khiển/)) ? 1 : 0
  while (match(s, /<[A-Z][A-Z0-9_]*>/)) {
    name = substr(s, RSTART + 1, RLENGTH - 2); s = substr(s, RSTART + RLENGTH)
    if (index(tags, " " name " ") > 0) continue
    if (!(name in first)) first[name] = ln
    if (kind == "B" && !(name in firstb)) firstb[name] = ln
    if (qual && !(name in copy)) copy[name] = ln
  }
}
END {
  for (n in first) {
    if (index(EXCL, " " n " ") > 0 || n ~ /_ROLE_ARN$/)
      print first[n] "\tPlaceholder <" n "> is not allowed: its value has a Fixed_Lookup, so it must be an Auto_Variable"
    if ((n in firstb) && (!(n in copy) || copy[n] + 0 > firstb[n] + 0))
      print firstb[n] "\tPlaceholder <" n "> has no Copy_Instruction at or before its first use in a command block"
  }
}
AWK

# Normalised Bash blocks of a classified page: comment and blank lines dropped, block markers kept.
cat >"$TMP/norm.awk" <<'AWK'
BEGIN { FS = "\t"; last = -1; n = 0 }
$2 == "B" {
  if ($3 != last) { last = $3; n++; print "@@BLOCK " n }
  t = $0; sub(/^[^\t]*\t[^\t]*\t[^\t]*\t/, "", t)
  if (t ~ /^[ \t]*#/ || t ~ /^[ \t]*$/) next
  print t
}
AWK

cls() { clean "$1" | awk -f "$TMP/classify.awk"; }

# "<line>\t<text>" of prose lines with inline code spans removed.
prose() {
  awk -F'\t' '$2 == "P" { t = $0; sub(/^[^\t]*\t[^\t]*\t[^\t]*\t/, "", t); gsub(/`[^`]*`/, "", t); print $1 "\t" t }' "$1"
}

# "<line>\t<kind>\t<text>" of every non-fence line.
author_text() {
  awk -F'\t' '$2 != "F" { t = $0; sub(/^[^\t]*\t[^\t]*\t[^\t]*\t/, "", t); print $1 "\t" $2 "\t" t }' "$1"
}

# ---- Page lookup -------------------------------------------------------------------------

sdir() { # $1 section number -> folder path, or empty
  local d
  for d in "$CH"/5."$1"-*/; do
    [ -d "$d" ] && { echo "${d%/}"; return 0; }
  done
  return 0
}

kfile() { # $1 key (L or 1..11), $2 lang (en|vi) -> file path, or empty
  local suf=.md d
  [ "$2" = vi ] && suf=.vi.md
  if [ "$1" = L ]; then
    echo "$CH/_index$suf"
  else
    d=$(sdir "$1")
    [ -n "$d" ] && echo "$d/_index$suf"
  fi
  return 0
}

kdisplay() { # $1 key, $2 lang -> path usable in messages even when the page is missing
  local f
  f=$(kfile "$1" "$2")
  if [ -n "$f" ]; then echo "$f"; else echo "$CH/5.$1-?/_index.md"; fi
}

for K in $KEYS; do
  for LANG_ in en vi; do
    F=$(kfile "$K" "$LANG_")
    [ -n "$F" ] && [ -f "$F" ] && cls "$F" >"$CLS/$K.$LANG_.tsv"
  done
done

# Variable analysis for every page (needed by checks 6, 7 and 9).
: >"$TMP/defs.txt"
for K in 1 2 3 4 5 6 7 8 9 10 11; do
  for LANG_ in en vi; do
    [ -f "$CLS/$K.$LANG_.tsv" ] || continue
    awk -f "$TMP/vars.awk" "$CLS/$K.$LANG_.tsv" >"$VARS/$K.$LANG_.out"
    awk -F'\t' '$1 == "DEF" { print $3 }' "$VARS/$K.$LANG_.out" >>"$TMP/defs.txt"
  done
done
sort -u "$TMP/defs.txt" -o "$TMP/defs.txt"

# ==========================================================================================
# 1. Bilingual heading parity (12.1, 12.2)
# ==========================================================================================
c_parity() {
  local K f1 f2 i n1 n2 min a b
  local -a A B
  for K in $KEYS; do
    f1=$(kdisplay "$K" en); f2=$(kdisplay "$K" vi)
    if [ ! -f "$CLS/$K.en.tsv" ] || [ ! -f "$CLS/$K.vi.tsv" ]; then
      [ -f "$CLS/$K.en.tsv" ] || vio parity "$f1" 0 "English file is missing"
      [ -f "$CLS/$K.vi.tsv" ] || vio parity "$f2" 0 "Vietnamese file is missing"
      continue
    fi
    mapfile -t A < <(awk -f "$TMP/headsig.awk" "$CLS/$K.en.tsv")
    mapfile -t B < <(awk -f "$TMP/headsig.awk" "$CLS/$K.vi.tsv")
    n1=${#A[@]}; n2=${#B[@]}
    [ "$n1" -eq "$n2" ] || vio parity "$f2" 0 "heading count differs: English $n1, Vietnamese $n2"
    # Template headings are English in both languages (5.3 to 5.10).
    if [ "$K" != L ] && [ "$K" -ge 3 ] && [ "$K" -le 10 ]; then
      local H LG
      for LG in en vi; do
        for H in "Set variables" "What it creates" "Depends on" "Create the resources" "Values to record" "Post-deploy steps" "Verify"; do
          clean "$(kfile "$K" "$LG")" | grep -qxF "## $H" \
            || vio parity "$(kfile "$K" "$LG")" 0 "template heading '## $H' is missing (heading texts stay in English in both languages)"
        done
      done
    fi
    min=$((n1 < n2 ? n1 : n2))
    for ((i = 0; i < min; i++)); do
      a=${A[i]#*$'\t'}; b=${B[i]#*$'\t'}
      [ "$a" = "$b" ] || vio parity "$f2" "${B[i]%%$'\t'*}" "heading #$((i + 1)) differs from English line ${A[i]%%$'\t'*} (level|number|code: en '$a', vi '$b')"
    done
  done
}

# ==========================================================================================
# 2. Resource_Name coverage (12.3)
# ==========================================================================================
c_coverage() {
  local N G NAME LANG_ f
  for N in 3 4 5 6 7 8 9 10; do
    G="$ROOT/guides/cloudformation/${GUIDE_OF[$N]}.md"
    if [ ! -f "$G" ]; then vio coverage "$G" 0 "Source_Guide is missing"; continue; fi
    while IFS= read -r NAME; do
      for LANG_ in en vi; do
        f=$(kfile "$N" "$LANG_")
        if [ -z "$f" ] || [ ! -f "$f" ]; then continue; fi
        grep -qF -- "$NAME" "$f" || vio coverage "$f" 0 "Resource_Name '$NAME' from ${GUIDE_OF[$N]}.md is not on the page"
      done
    done < <(clean "$G" | awk '
      /^## / { insec = ($0 ~ /^## What it creates[ \t]*$/); next }
      insec && /^\|/ {
        n = split($0, c, "|")
        for (i = 4; i < n; i++) {
          s = c[i]
          while (match(s, /`[^`]+`/)) { print substr(s, RSTART + 1, RLENGTH - 2); s = substr(s, RSTART + RLENGTH) }
        }
      }' | grep -E '^(alias/)?ridenow[A-Za-z0-9/_-]*$' | grep -vE '[0-9]{12}' | sort -u)
  done
}

# ==========================================================================================
# 3. Forbidden terms (1.4, 12.4)
# ==========================================================================================
c_forbidden() {
  local F pat label
  local -a PATS=(
    'RakiBookery|(?i)RakiBookery'
    'PHP|(?i)\bPHP\b'
    'MySQL|(?i)MySQL'
    'ECS|\bECS\b'
    'S3 gateway endpoint|(?i)S3 gateway endpoint'
    'Route 53 Resolver|(?i)Route ?53 Resolver'
    'Site-to-Site VPN|(?i)Site-to-Site VPN'
  )
  [ -d "$CH" ] || { vio forbidden "$CH" 0 "Workshop_Chapter folder is missing"; return; }
  while IFS= read -r F; do
    for P in "${PATS[@]}"; do
      label=${P%%|*}; pat=${P#*|}
      while IFS= read -r HIT; do
        vio forbidden "$F" "${HIT%%:*}" "forbidden term '$label'"
      done < <(clean "$F" | grep -nP -- "$pat")
    done
  done < <(find "$CH" -type f -name '*.md' | sort)
}

# ==========================================================================================
# 4. Links and images of the Workshop_Chapter (11.5, 11.6, 12.5, 14.2)
# ==========================================================================================
site_exists() { # $1 path
  local p=$1
  [ -f "$p" ] && return 0
  if [ -d "$p" ]; then
    compgen -G "$p/_index*.md" >/dev/null && return 0
    compgen -G "$p/index*.md" >/dev/null && return 0
  fi
  [ -f "$p.md" ] && return 0
  return 1
}

resolve_link() { # $1 source file, $2 target without anchor
  local f=$1 t=$2 p
  case "$t" in
    /*)
      p=${t#/}; p=${p#fcj-workshop-ridenow/}; p=${p#vi/}; p=${p%/}
      site_exists "$STATIC/$p" || site_exists "$SITE/content/$p"
      ;;
    *)
      p=$(realpath -m "$(dirname "$f")/$t")
      site_exists "$p" || site_exists "$STATIC/${p#"$SITE"/content/}"
      ;;
  esac
}

skip_target() { # $1 target; true when it is not an internal reference
  case "$1" in
    http://* | https://* | mailto:* | tel:* | '#'* | '' | *'{{'* | *'<'* | *'$'*) return 0 ;;
  esac
  return 1
}

c_links() {
  local F LN IMG TGT T
  [ -d "$CH" ] || { vio links "$CH" 0 "Workshop_Chapter folder is missing"; return; }
  while IFS= read -r F; do
    while IFS=$'\t' read -r LN IMG TGT; do
      skip_target "$TGT" && continue
      T=${TGT%%#*}; T=${T%%\?*}
      [ -n "$T" ] || continue
      if ! resolve_link "$F" "$T"; then
        if [ "$IMG" = 1 ]; then vio links "$F" "$LN" "missing image '$TGT'"
        else vio links "$F" "$LN" "broken internal link '$TGT'"; fi
      fi
    done < <(cls "$F" | prose /dev/stdin | awk -f "$TMP/links.awk")
  done < <(find "$CH" -type f -name '*.md' | sort)

  # No page of the site may point at the old or a non-existent Cleanup folder.
  while IFS= read -r HIT; do
    F=${HIT%%:*}; REST=${HIT#*:}
    vio links "$F" "${REST%%:*}" "reference to a Cleanup folder that must not exist (5.10-Cleanup or 5.12-Cleanup)"
  done < <(grep -rnI -E '5\.10-Cleanup|5\.12-Cleanup' "$SITE/content" --include='*.md' 2>/dev/null)
}

# ==========================================================================================
# 5. Dangling references (12.7, 15.6, 15.7)
# ==========================================================================================
slug_list() { # $1 markdown file -> GitHub-style anchors, one per line
  cls "$1" | awk -F'\t' '$2 == "P" { t = $0; sub(/^[^\t]*\t[^\t]*\t[^\t]*\t/, "", t); if (t ~ /^#+[ \t]/) print t }' \
    | sed -E 's/^#+[ \t]+//; s/[ \t]+#+[ \t]*$//' | tr 'A-Z' 'a-z' | sed -E 's/[^a-z0-9 _-]//g; s/ /-/g' \
    | awk '{ n = seen[$0]++; if (n == 0) print $0; else print $0 "-" n }'
}

c_dangling() {
  local RB1='00-deploy-'"runbook" RB2='deploy-'"runbook" F LN REST TGT T ANCH DEST SLUGS
  ( cd "$ROOT" && git -c safe.directory='*' ls-files -co --exclude-standard ) 2>/dev/null \
    | grep -vE '^(\.git|\.scratch|\.tmp|node_modules|\.kiro/specs/workshop-site-content-update)/|(^|/)(target|node_modules)/' \
    | grep -vxF 'guides/scripts/check-workshop-content.sh' >"$TMP/repo-files.txt"
  while IFS= read -r F; do [ -f "$ROOT/$F" ] && printf '%s\n' "$F"; done <"$TMP/repo-files.txt" >"$TMP/repo-files-existing.txt"

  # (a) the deleted Runbook, anywhere in the repository
  while IFS= read -r HIT; do
    F=${HIT%%:*}; REST=${HIT#*:}
    vio dangling "$ROOT/$F" "${REST%%:*}" "mentions the deleted Runbook ('$RB1' or '$RB2')"
  done < <(cd "$ROOT" && tr '\n' '\0' <"$TMP/repo-files-existing.txt" | xargs -0 grep -InE -- "$RB1|$RB2" 2>/dev/null)

  # (b) the Workshop_Chapter
  if [ -d "$CH" ]; then
    while IFS= read -r F; do
      while IFS= read -r HIT; do
        vio dangling "$F" "${HIT%%:*}" "Workshop_Chapter mentions '$(printf '%s' "${HIT#*:}" | grep -oiE 'deploy-runbook|deploy runbook|Discovery_Block|5\.12' | head -1)'"
      done < <(clean "$F" | grep -nE -i 'deploy-runbook|deploy runbook' ; clean "$F" | grep -nE 'Discovery_Block|(^|[^0-9.])5\.12([^0-9]|$)')
    done < <(find "$CH" -type f -name '*.md' | sort)
  fi

  # (c) Markdown links and anchors in guides/, docs/, iac/README.md, .kiro/specs/
  mkdir -p "$TMP/slugs"
  while IFS= read -r REL; do
    F="$ROOT/$REL"
    while IFS=$'\t' read -r LN _IMG TGT; do
      skip_target "$TGT" && [ "${TGT#\#}" = "$TGT" ] && continue
      case "$TGT" in /*) continue ;; esac
      T=${TGT%%#*}
      ANCH=""
      case "$TGT" in *'#'*) ANCH=${TGT#*#} ;; esac
      if [ -z "$T" ]; then
        DEST=$F
      else
        T=${T%%\?*}
        DEST=$(realpath -m "$(dirname "$F")/$T")
        if [ ! -e "$DEST" ]; then vio dangling "$F" "$LN" "link target '$TGT' does not exist"; continue; fi
      fi
      if [ -n "$ANCH" ] && [ -f "$DEST" ]; then
        case "$DEST" in
          *.md)
            SLUGS="$TMP/slugs/$(printf '%s' "$DEST" | tr '/ ' '__')"
            [ -f "$SLUGS" ] || slug_list "$DEST" >"$SLUGS"
            grep -qxF -- "$ANCH" "$SLUGS" || vio dangling "$F" "$LN" "anchor '#$ANCH' not found in $(basename "$DEST")"
            ;;
        esac
      fi
    done < <(cls "$F" | prose /dev/stdin | awk -f "$TMP/links.awk")
  done < <(grep -E '^(guides|docs)/.*\.md$|^iac/README\.md$|^\.kiro/specs/.*\.md$' "$TMP/repo-files-existing.txt")
}

# ==========================================================================================
# 6. Placeholder and Author_Value rules (16.3 to 16.7, 16.10, 16.11, 17.12 d and e)
# ==========================================================================================
REGION_RE='\b(us|eu|ap|sa|ca|me|af|il|mx)-(north|south|east|west|central|northeast|southeast|southwest|northwest)-[0-9]\b'

c_placeholders() {
  local K LANG_ f cf EX LN KIND MSG TXT P
  EX=" ACCOUNT_ID AWS_REGION VPC_ID PUBLIC_SUBNET_IDS PRIVATE_SUBNET_IDS CLUSTER_SG_ID DB_SG_ID REDIS_SG_ID KMS_KEY_ARN DB_ENDPOINT DB_SECRET_ARN TOPIC_ARN QUEUE_URL REDIS_ENDPOINT OIDC_ID ALB_DNS_NAME CLOUDFRONT_ID CLOUDFRONT_DOMAIN $(tr '\n' ' ' <"$TMP/defs.txt") "
  local -a AUTHOR=(
    '(?<![0-9])(?!123456789012)[0-9]{12}(?![0-9])~~12-digit AWS account id (only the masked sample 123456789012 is allowed)'
    '\b(vpc|subnet|sg|igw|rtb|eipalloc|eni)-[0-9a-f]{8,17}\b~~generated resource id'
    '\bE(?=[0-9A-Z]*[0-9])[0-9A-Z]{12,13}\b~~CloudFront distribution id'
    '\bd[0-9a-z]{12,14}\.cloudfront\.net~~CloudFront domain name'
    '[A-Za-z0-9-]*-[0-9]{6,}\.[a-z0-9-]+\.elb\.amazonaws\.com~~ALB domain name'
    '\.[a-z0-9]{8,}\.[a-z0-9-]+\.(rds|cache)\.amazonaws\.com~~database or cache endpoint host name'
    '\b[0-9A-F]{32}\.[a-z0-9]+\.[a-z0-9-]+\.eks\.amazonaws\.com~~EKS endpoint host name'
  )
  for K in $KEYS; do
    for LANG_ in en vi; do
      cf="$CLS/$K.$LANG_.tsv"
      [ -f "$cf" ] || continue
      f=$(kfile "$K" "$LANG_")
      author_text "$cf" >"$TMP/author.txt"

      if [ "$K" != L ]; then
        while IFS=$'\t' read -r LN MSG; do
          vio placeholders "$f" "$LN" "$MSG"
        done < <(awk -v EXCL="$EX" -f "$TMP/ph.awk" "$cf")

        # 16.7: no command reads the Discovery_Block, prod.json, or a CloudFormation export or output
        while IFS=$'\t' read -r LN KIND TXT; do
          vio placeholders "$f" "$LN" "command reads a value through the Discovery_Block, iac/params/prod.json, or CloudFormation: ${TXT:0:80}"
        done < <(grep -P '^[0-9]+\tB\t(?![ \t]*#).*(prod\.json|list-exports|describe-stacks|aws cloudformation|Fn::ImportValue|Discovery_Block)' "$TMP/author.txt")
      fi

      # 16.5, 16.6: no Author_Value (masked forms such as vpc-0abc... do not match)
      for P in "${AUTHOR[@]}"; do
        while IFS=$'\t' read -r LN KIND TXT; do
          vio placeholders "$f" "$LN" "Author_Value (${P#*~~}): ${TXT:0:80}"
        done < <(grep -P -- "^[0-9]+\t[A-Z]\t.*${P%%~~*}" "$TMP/author.txt")
      done

      # 17.8, 17.12 d: no region literal in a command, ARN or URL
      while IFS=$'\t' read -r LN KIND TXT; do
        vio placeholders "$f" "$LN" "region literal in a command, ARN or URL (use \"\${AWS_REGION}\"): ${TXT:0:80}"
      done < <({ grep -P -- "^[0-9]+\tB\t(?![ \t]*#).*$REGION_RE" "$TMP/author.txt"
                 grep -P -- "^[0-9]+\tP\t(?=.*(arn:|://|amazonaws\.com)).*$REGION_RE" "$TMP/author.txt"; })
    done
  done
}

# ==========================================================================================
# 7. Auto_Variable rules (17.3, 17.12 a to c)
# ==========================================================================================
c_autovars() {
  local K LANG_ f LN MSG NAME RHS N0 name rhs
  local -A HOME_PAGE HOME_RHS HOME_LN
  for LANG_ in en vi; do
    for K in 1 2 3 4 5 6 7 8 9 10 11; do
      [ -f "$VARS/$K.$LANG_.out" ] || continue
      f=$(kfile "$K" "$LANG_")
      while IFS=$'\t' read -r LN MSG; do
        vio auto-variables "$f" "$LN" "$MSG"
      done < <(awk -F'\t' '$1 == "ERR" { print $2 "\t" $3 }' "$VARS/$K.$LANG_.out")
    done
  done

  # 17.3: prerequisites page defines the shared variables
  for LANG_ in en vi; do
    [ -f "$VARS/2.$LANG_.out" ] || continue
    for NAME in ACCOUNT_ID AWS_REGION AWS_DEFAULT_REGION ENV CLUSTER_NAME IMAGE_TAG; do
      awk -F'\t' -v n="$NAME" '$1 == "DEF" && $3 == n { found = 1 } END { exit !found }' "$VARS/2.$LANG_.out" \
        || vio auto-variables "$(kfile 2 "$LANG_")" 0 "prerequisites page does not define $NAME"
    done
  done

  # 17.12 c: one Variable_Home_Page per variable; later pages restate the same definition
  for LANG_ in en vi; do
    HOME_PAGE=(); HOME_RHS=(); HOME_LN=()
    for K in 1 2 3 4 5 6 7 8 9 10 11; do
      [ -f "$VARS/$K.$LANG_.out" ] || continue
      f=$(kfile "$K" "$LANG_")
      while IFS=$'\t' read -r LN name rhs; do
        rhs=$(printf '%s' "$rhs" | sed -E 's/[[:space:]]+/ /g')
        if [ -z "${HOME_PAGE[$name]:-}" ]; then
          HOME_PAGE[$name]=$K; HOME_RHS[$name]=$rhs; HOME_LN[$name]=$LN
        elif [ "${HOME_PAGE[$name]}" != "$K" ] && [ "${HOME_RHS[$name]}" != "$rhs" ]; then
          vio auto-variables "$f" "$LN" "$name is defined differently from its Variable_Home_Page 5.${HOME_PAGE[$name]} (line ${HOME_LN[$name]}); restate the same Fixed_Lookup"
        fi
      done < <(awk -F'\t' '$1 == "DEF" { print $2 "\t" $3 "\t" $4 }' "$VARS/$K.$LANG_.out")
    done
  done
}

# ==========================================================================================
# 8. Structure (3.5, 12.9)
# ==========================================================================================
frontmatter() { # $1 file
  clean "$1" | awk '/^---[ \t]*$/ { n++; next } n == 1 { print } n >= 2 { exit }'
}

c_structure() {
  local N D d base K LANG_ f fm n seen
  local -A NUM_COUNT
  [ -d "$CH" ] || { vio structure "$CH" 0 "Workshop_Chapter folder is missing"; return; }
  for d in "$CH"/*/; do
    [ -d "$d" ] || continue
    base=$(basename "$d")
    if [[ $base =~ ^5\.([0-9]+)- ]]; then
      n=${BASH_REMATCH[1]}
      if [ "$n" -lt 1 ] || [ "$n" -gt 11 ]; then vio structure "$d" 0 "folder '$base' is outside 5.1 to 5.11"; fi
      NUM_COUNT[$n]=$(( ${NUM_COUNT[$n]:-0} + 1 ))
    else
      vio structure "$d" 0 "unexpected folder '$base' in the Workshop_Chapter"
    fi
  done
  for N in 1 2 3 4 5 6 7 8 9 10 11; do
    [ "${NUM_COUNT[$N]:-0}" -eq 1 ] || vio structure "$CH" 0 "expected exactly one folder 5.$N-*, found ${NUM_COUNT[$N]:-0}"
  done
  for base in 5.10-Cleanup 5.12-Cleanup; do
    [ -e "$CH/$base" ] && vio structure "$CH/$base" 0 "folder '$base' must not exist"
  done

  for N in 1 2 3 4 5 6 7 8 9 10 11; do
    for LANG_ in en vi; do
      f=$(kfile "$N" "$LANG_")
      [ -n "$f" ] && [ -f "$f" ] || continue
      fm=$(frontmatter "$f")
      for K in title date weight chapter pre; do
        printf '%s\n' "$fm" | grep -qE "^$K[[:space:]]*:" || vio structure "$f" 1 "front matter key '$K' is missing"
      done
      printf '%s\n' "$fm" | grep -qE "^weight[[:space:]]*:[[:space:]]*$N[[:space:]]*$" \
        || vio structure "$f" 1 "front matter weight must be $N"
      printf '%s\n' "$fm" | grep -qE "^pre[[:space:]]*:[[:space:]]*\"[[:space:]]*<b>[[:space:]]*5\.$N\.[[:space:]]*</b>[[:space:]]*\"[[:space:]]*$" \
        || vio structure "$f" 1 "front matter pre must be \" <b> 5.$N. </b> \""
    done
  done

  # Landing_Page table of contents: exactly the eleven folders, in order
  for LANG_ in en vi; do
    f=$(kfile L "$LANG_")
    [ -f "$CLS/L.$LANG_.tsv" ] || continue
    seen=""
    while IFS=$'\t' read -r LN _IMG TGT; do
      if [[ $TGT =~ ^5\.([0-9]+)-[^/]*/?$ ]]; then
        seen="$seen ${BASH_REMATCH[1]}"
        [ -d "$CH/${TGT%/}" ] || vio structure "$f" "$LN" "table of contents entry '$TGT' is not a folder of the chapter"
      fi
    done < <(prose "$CLS/L.$LANG_.tsv" | awk -f "$TMP/links.awk")
    seen=${seen# }
    [ "$seen" = "1 2 3 4 5 6 7 8 9 10 11" ] \
      || vio structure "$f" 0 "table of contents must list 5.1 to 5.11 once each, in order (found: ${seen:-none})"
  done
}

# ==========================================================================================
# 9. Bash blocks and names identical across languages (12.10)
# ==========================================================================================
c_identity() {
  local N f1 f2 d
  for N in 1 2 3 4 5 6 7 8 9 10 11; do
    [ -f "$CLS/$N.en.tsv" ] && [ -f "$CLS/$N.vi.tsv" ] || continue
    f1=$(kfile "$N" en); f2=$(kfile "$N" vi)

    d=$(diff <(awk -f "$TMP/norm.awk" "$CLS/$N.en.tsv") <(awk -f "$TMP/norm.awk" "$CLS/$N.vi.tsv") | grep -E '^[<>@]|^[0-9]' | head -4 | tr '\n' ' ')
    [ -z "$d" ] || vio bash-identity "$f2" 0 "Bash blocks differ from the English file (comments and prose may differ, commands may not): ${d:0:200}"

    d=$(diff <(awk -F'\t' '$1 == "DEF" { print $3 }' "$VARS/$N.en.out") <(awk -F'\t' '$1 == "DEF" { print $3 }' "$VARS/$N.vi.out") | grep -E '^[<>]' | head -4 | tr '\n' ' ')
    [ -z "$d" ] || vio bash-identity "$f2" 0 "Auto_Variable names or order differ from the English file: $d"

    d=$(diff <(clean "$f1" | grep -oE '<[A-Z][A-Z0-9_]*>' | sort -u) <(clean "$f2" | grep -oE '<[A-Z][A-Z0-9_]*>' | sort -u) | grep -E '^[<>]' | head -4 | tr '\n' ' ')
    [ -z "$d" ] || vio bash-identity "$f2" 0 "Placeholder names differ from the English file: $d"
  done
}

# ==========================================================================================
# 10. Hugo build (11.1)
# ==========================================================================================
c_hugo() {
  local H D OUT RC
  if [ ! -d "$SITE" ]; then vio hugo-build "$SITE" 0 "Workshop_Site folder is missing"; return; fi
  H=$(command -v hugo || command -v hugo.exe) || { vio hugo-build "$SITE" 0 "hugo is not installed"; return; }
  D="$TMP/public"
  case "$H" in *.exe) command -v wslpath >/dev/null 2>&1 && D=$(wslpath -w "$TMP/public") ;; esac
  OUT=$(cd "$SITE" && "$H" --destination "$D" 2>&1)
  RC=$?
  printf '%s\n' "$OUT" >>"$LOG"
  [ "$RC" -eq 0 ] || vio hugo-build "$SITE" 0 "hugo exited with status $RC"
  while IFS= read -r L; do
    vio hugo-build "$SITE" 0 "hugo reported: ${L:0:200}"
  done < <(printf '%s\n' "$OUT" | grep -E '^(ERROR|Error)|[[:space:]]ERROR[[:space:]]')
}

# ==========================================================================================
say "check-workshop-content: $(date '+%Y-%m-%d %H:%M:%S')"
c_parity
c_coverage
c_forbidden
c_links
c_dangling
c_placeholders
c_autovars
c_structure
c_identity
c_hugo

TOTAL=0
i=0
for C in "${CATS[@]}"; do
  i=$((i + 1))
  N=$(grep -cxF "$C" "$VIOL" || true)
  TOTAL=$((TOTAL + N))
  if [ "$N" -eq 0 ]; then say "[$i] $C: OK"; else say "[$i] $C: $N violation(s)"; fi
done
# Any category name outside the known ten also counts (never report OK on a stray violation).
ALLV=$(wc -l <"$VIOL" | tr -d ' ')
[ "$ALLV" -gt "$TOTAL" ] && TOTAL=$ALLV
rm -rf "$TMP" "$VIOL"

if [ "$TOTAL" -gt 0 ]; then
  say "check-workshop-content: $TOTAL violation(s); log in .tmp/check-workshop-content.log"
  exit 1
fi
say "check-workshop-content: OK"
