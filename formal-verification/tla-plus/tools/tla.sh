#!/usr/bin/env bash
# Thin wrapper around the TLA+ tools (TLC model checker + PlusCal translator).
#
#   tools/tla.sh fetch                 download the pinned tla2tools.jar (sha256-verified)
#   tools/tla.sh tlc <Spec.tla> [<Model.cfg>] [TLC args...]
#                                      run TLC interactively, full output
#   tools/tla.sh pcal <Spec.tla>...    translate PlusCal into TLA+ (in place)
#   tools/tla.sh pcal-check <Spec.tla>...
#                                      fail if a committed PlusCal translation is stale
#   tools/tla.sh check <dir|cfg>...    run every model and assert its expected outcome
#
# Every model (.cfg) that `check` runs declares, in its header comments, which
# module it checks and what TLC is expected to report:
#
#   \* SPEC:   BlockingQueue.tla
#   \* EXPECT: deadlock
#
# Outcomes: pass, deadlock, safety [Invariant], liveness (a temporal property),
# action (an action property, e.g. a refinement), assert. Naming the invariant
# makes the check stricter. Trace validation reads better with two aliases:
# `accepted <Invariant>` (= safety <Invariant>: the "whole log matched"
# invariant was violated) and `rejected` (= pass: no behaviour matches the log).
#
# A buggy design that TLC *stops* catching fails the run just as a fixed one
# that TLC starts rejecting does.
#
# Environment:
#   TLA2TOOLS_JAR   use this jar instead of the pinned download
#   TLC_WORKERS     TLC worker threads (default 1: breadth-first on one worker
#                   gives the shortest, reproducible counterexample)
#   TLC_JAVA_OPTS   extra JVM options (default: -XX:+UseParallelGC)
set -euo pipefail

# v1.7.4 is the latest *stable* release; v1.8.0 is a rolling nightly whose jar
# (and checksum) changes under the same URL, so it cannot be pinned.
TLA_VERSION="v1.7.4"
TLA_URL="https://github.com/tlaplus/tlaplus/releases/download/${TLA_VERSION}/tla2tools.jar"
TLA_SHA256="936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLS_DIR="${ROOT}/.tools"
JAR="${TLA2TOOLS_JAR:-${TOOLS_DIR}/tla2tools-${TLA_VERSION}.jar}"
WORKERS="${TLC_WORKERS:-1}"
read -r -a JAVA_OPTS <<<"${TLC_JAVA_OPTS:--XX:+UseParallelGC}"

die() { echo "tla.sh: $*" >&2; exit 2; }

sha256() {
  if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1
  else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

fetch() {
  command -v java >/dev/null || die "java not found (TLC needs a JRE, 11 or newer)"
  if [[ -n "${TLA2TOOLS_JAR:-}" ]]; then
    [[ -f "$JAR" ]] || die "TLA2TOOLS_JAR=$JAR does not exist"
    return
  fi
  [[ -f "$JAR" ]] && return
  mkdir -p "$TOOLS_DIR"
  echo "Downloading tla2tools.jar ${TLA_VERSION} ..." >&2
  curl -fsSL --retry 3 -o "${JAR}.part" "$TLA_URL"
  local got; got="$(sha256 "${JAR}.part")"
  if [[ "$got" != "$TLA_SHA256" ]]; then
    rm -f "${JAR}.part"
    die "checksum mismatch for tla2tools.jar: expected ${TLA_SHA256}, got ${got}"
  fi
  mv "${JAR}.part" "$JAR"
}

java_tla() { java "${JAVA_OPTS[@]}" -cp "$JAR" "$@"; }

# Run TLC with its scratch state directory outside the source tree.
run_tlc() {
  local spec="$1" cfg="$2"; shift 2
  local meta; meta="$(mktemp -d "${TMPDIR:-/tmp}/tlc-states.XXXXXX")"
  local dir; dir="$(dirname "$spec")"
  local rc=0
  # TLC unpacks its standard modules (Naturals.tla, ...) into java.io.tmpdir;
  # a private one keeps concurrent runs from overwriting each other's mid-parse.
  mkdir -p "$meta/tmp"
  ( cd "$dir" && java_tla -Djava.io.tmpdir="$meta/tmp" tlc2.TLC -workers "$WORKERS" -metadir "$meta" \
      -config "$(basename "$cfg")" "$@" "$(basename "$spec")" ) || rc=$?
  rm -rf "$meta"
  return "$rc"
}

header() { # header <cfg> <KEY> -> value of the first "\* KEY: value" line
  sed -n "s/^[[:space:]]*\\\\\\*[[:space:]]*$2:[[:space:]]*//p" "$1" | head -n1 | sed 's/[[:space:]]*$//'
}

outcome_of() { # outcome_of <TLC exit code> <log> -> outcome keyword
  case "$1" in
    0) echo pass ;; 11) echo deadlock ;; 12) echo safety ;; 14) echo assert ;;
    # TLC exits 13 for temporal and action property violations alike.
    13) if grep -q '^Error: Action property' "$2"; then echo action; else echo liveness; fi ;;
    *) echo "error($1)" ;;
  esac
}

check_one() {
  local cfg="$1"
  local dir; dir="$(cd "$(dirname "$cfg")" && pwd)"
  local name; name="$(basename "$cfg" .cfg)"
  local spec_name; spec_name="$(header "$cfg" SPEC)"
  local expect; expect="$(header "$cfg" EXPECT)"
  [[ -n "$spec_name" ]] || die "$cfg: missing '\\* SPEC: <Module>.tla' header"
  [[ -n "$expect" ]] || die "$cfg: missing '\\* EXPECT: <outcome>' header"
  local want_outcome want_name alias=""
  read -r want_outcome want_name <<<"$expect"
  case "$want_outcome" in
    accepted | rejected) alias=1; [[ "$want_outcome" == accepted ]] && want_outcome=safety || want_outcome=pass ;;
    pass | deadlock | safety | liveness | action | assert) ;;
    *) die "$cfg: unknown EXPECT outcome '$want_outcome'" ;;
  esac

  local rel="${dir#"$ROOT"/}/$name.cfg"
  local log_dir="${TOOLS_DIR}/logs"; mkdir -p "$log_dir"
  local log="${log_dir}/${rel//\//__}.out"

  local start end rc=0
  start=$(date +%s)
  run_tlc "${dir}/${spec_name}" "${dir}/${name}.cfg" >"$log" 2>&1 || rc=$?
  end=$(date +%s)
  local got; got="$(outcome_of "$rc" "$log")"
  if [[ -n "$alias" ]]; then
    case "$got" in safety) got=accepted ;; pass) got=rejected ;; esac
    want_outcome="${expect%% *}"
  fi

  local ok=1
  [[ "$got" == "$want_outcome" ]] || ok=0
  if [[ $ok -eq 1 && -n "${want_name:-}" ]]; then
    grep -q "Invariant ${want_name} is violated" "$log" || ok=0
  fi

  local states; states="$(grep -Eo '[0-9,]+ distinct states found' "$log" | tail -n1 | cut -d' ' -f1 || true)"
  local trace_len; trace_len="$(grep -c '^State [0-9]*:' "$log" || true)"
  local detail="expected ${expect}, got ${got}; ${states:-?} distinct states"
  [[ "$trace_len" -gt 0 ]] && detail+=", ${trace_len}-state trace"
  detail+=", $((end - start))s"
  if [[ $ok -eq 1 ]]; then
    printf '  ok    %-66s %s\n' "$rel" "$detail"
  else
    printf '  FAIL  %-66s %s\n' "$rel" "$detail"
    echo "        TLC output: $log"
    grep -v '^Picked up JAVA_TOOL_OPTIONS' "$log" | tail -n 40 | sed 's/^/        | /'
    return 1
  fi
}

check() {
  [[ $# -gt 0 ]] || die "usage: tla.sh check <dir|cfg>..."
  local cfgs=() arg
  for arg in "$@"; do
    if [[ -d "$arg" ]]; then
      while IFS= read -r f; do cfgs+=("$f"); done < <(find "$arg" -name '*.cfg' -not -path '*/.tools/*' | sort)
    else
      cfgs+=("$arg")
    fi
  done
  [[ ${#cfgs[@]} -gt 0 ]] || die "no .cfg models found in: $*"
  local failed=0 cfg
  for cfg in "${cfgs[@]}"; do
    # Models without an EXPECT header (e.g. generated trace-validation models) are skipped.
    [[ -n "$(header "$cfg" EXPECT)" ]] || continue
    check_one "$cfg" || failed=$((failed + 1))
  done
  if [[ $failed -gt 0 ]]; then
    echo "$failed model(s) did not behave as expected" >&2
    return 1
  fi
}

pcal() {
  local spec
  for spec in "$@"; do
    ( cd "$(dirname "$spec")" && java_tla pcal.trans -nocfg "$(basename "$spec")" ) >/dev/null
    rm -f "${spec%.tla}.old"
  done
}

pcal_check() {
  local spec failed=0
  for spec in "$@"; do
    local tmp; tmp="$(mktemp -d "${TMPDIR:-/tmp}/pcal-check.XXXXXX")"
    cp "$spec" "$tmp/"
    ( cd "$tmp" && java_tla pcal.trans -nocfg "$(basename "$spec")" ) >/dev/null
    if diff -q "$spec" "$tmp/$(basename "$spec")" >/dev/null; then
      echo "  ok    $spec (PlusCal translation up to date)"
    else
      echo "  FAIL  $spec: PlusCal translation is stale; run: tools/tla.sh pcal $spec"
      failed=1
    fi
    rm -rf "$tmp"
  done
  return "$failed"
}

cmd="${1:-}"; shift || true
case "$cmd" in
  fetch) fetch ;;
  tlc)
    fetch
    [[ $# -ge 1 ]] || die "usage: tla.sh tlc <Spec.tla> [<Model.cfg>] [TLC args...]"
    spec="$1"; shift
    cfg="${spec%.tla}.cfg"
    if [[ $# -ge 1 && "$1" == *.cfg ]]; then cfg="$1"; shift; fi
    [[ "$(dirname "$cfg")" == "$(dirname "$spec")" ]] || die "spec and cfg must be in the same directory"
    run_tlc "$spec" "$cfg" "$@"
    ;;
  pcal) fetch; pcal "$@" ;;
  pcal-check) fetch; pcal_check "$@" ;;
  check) fetch; check "$@" ;;
  *) sed -n '2,27p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; [[ -z "$cmd" || "$cmd" == -h || "$cmd" == --help ]] ;;
esac
