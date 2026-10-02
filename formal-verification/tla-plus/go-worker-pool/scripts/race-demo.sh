#!/usr/bin/env bash
# What does the race detector see? Builds cmd/stress with -race and runs it
# (no test hooks) against every variant, then counts DATA RACE reports.
#
#   scripts/race-demo.sh [runs-per-profile] [single-run-processes]
#
# Part 2 runs the buggy pool once per process, many times, because the race
# detector reports a given pair of racing statements only once per process:
# it shows how often a report comes WITHOUT the panic ever happening.
set -euo pipefail
cd "$(dirname "$0")/.."
runs="${1:-500}"
procs="${2:-200}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

go build -race -o "$tmp/stress" ./cmd/stress
# atexit_sleep_ms=0: the race runtime otherwise sleeps 1s at every exit
export GORACE="halt_on_error=0 exitcode=0 atexit_sleep_ms=0"

echo "== 1. stress under -race, ${runs} runs per load profile"
unexpected=0
for v in buggy quitchan fixed; do
  # cmd/stress recovers the buggy pool's panics and exits 0; it exits non-zero
  # only if the fixed pool violated a property or something else panicked.
  rc=0
  "$tmp/stress" -variant "$v" -runs "$runs" >"$tmp/$v.out" 2>&1 || rc=$?
  grep -E "^$v " "$tmp/$v.out" | sed 's/^/   /'
  reports="$(grep -c 'WARNING: DATA RACE' "$tmp/$v.out" || true)"
  echo "   -> $v: $reports DATA RACE report(s)"
  if [[ "$reports" -gt 0 ]]; then
    grep -A12 'WARNING: DATA RACE' "$tmp/$v.out" | grep -E '^(Write|Previous|  runtime\.|  github)' | sed 's/^/      | /' | head -8
    [[ "$v" == buggy ]] || unexpected=1
  fi
  if [[ "$rc" -ne 0 ]]; then
    echo "   -> $v: cmd/stress exited with status $rc"
    grep -E '^(stress:|panic:|    [0-9]+ runs handled a job twice)' "$tmp/$v.out" | sed 's/^/      | /' | head -5
    unexpected=1
  fi
done

echo "== 2. buggy pool, idle profile, one run per process, ${procs} processes"
both=0 race_only=0 panic_only=0 neither=0
for _ in $(seq "$procs"); do
  "$tmp/stress" -variant buggy -load idle -runs 1 >"$tmp/one.out" 2>&1 || true
  panicked="$(awk '$1 == "buggy" {print $4}' "$tmp/one.out")"
  raced=0; grep -q 'WARNING: DATA RACE' "$tmp/one.out" && raced=1
  case "$panicked$raced" in
    11) both=$((both + 1)) ;; 01) race_only=$((race_only + 1)) ;;
    10) panic_only=$((panic_only + 1)) ;; *) neither=$((neither + 1)) ;;
  esac
done
echo "   race reported + panicked: $both"
echo "   race reported, no panic:  $race_only"
echo "   panicked, no report:      $panic_only"
echo "   neither:                  $neither"

if [[ "$unexpected" -ne 0 ]]; then
  echo "race-demo: unexpected result above (a DATA RACE outside the buggy pool, or cmd/stress failed)" >&2
  exit 1
fi
