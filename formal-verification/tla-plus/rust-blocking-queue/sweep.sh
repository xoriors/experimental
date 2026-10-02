#!/usr/bin/env bash
# The sweep behind the README's "deadlocks iff producers + consumers > 2 x capacity" table:
# the buggy spec (spec/BlockingQueue.tla) for capacity 1..4 with 1..6 producers and 1..6
# consumers (at most 9 threads), each checked twice: with Spurious = FALSE (the idealised
# Condvar) and with Spurious = TRUE (the over-approximation of std's Condvar). Deadlock is
# checked as the NoDeadlock invariant, because TLC's own deadlock check is blind when
# spurious wakeups are enabled. Exits non-zero if any configuration breaks the rule.
#
#   ./sweep.sh          (or: make sweep)     about 240 TLC runs, several minutes
set -euo pipefail
cd "$(dirname "$0")"
TLA=../tools/tla.sh
dir=target/sweep
rm -rf "$dir" && mkdir -p "$dir"
# TLC resolves EXTENDS next to the checked module, and tla.sh wants the model beside it.
cp spec/BlockingQueueCommon.tla spec/BlockingQueue.tla "$dir"/

names() { # names p 3 -> "p1", "p2", "p3"
  local n out=""
  for ((n = 1; n <= $2; n++)); do out+="${out:+, }\"$1$n\""; done
  echo "$out"
}

runs=0 broken=0 same_states=0 passing=0
for k in 1 2 3 4; do
  smallest="" largest_free=0
  for p in 1 2 3 4 5 6; do
    for c in 1 2 3 4 5 6; do
      ((p + c <= 9)) || continue
      states_false=""
      for spurious in FALSE TRUE; do
        cfg="$dir/P${p}C${c}K${k}_Spurious${spurious}.cfg"
        cat >"$cfg" <<EOF
CONSTANTS
    Producers = {$(names p "$p")}
    Consumers = {$(names c "$c")}
    Capacity  = $k
    Spurious  = $spurious
SPECIFICATION Spec
INVARIANT TypeOK BoundedBuffer NoDeadlock
EOF
        rc=0
        "$TLA" tlc "$dir/BlockingQueue.tla" "$cfg" >"${cfg%.cfg}.out" 2>&1 || rc=$?
        runs=$((runs + 1))
        if ((p + c > 2 * k)); then want=12; else want=0; fi
        if [[ $rc -ne $want ]] || { [[ $rc -eq 12 ]] && ! grep -q 'Invariant NoDeadlock is violated' "${cfg%.cfg}.out"; }; then
          echo "  RULE BROKEN  P${p} C${c} K${k} Spurious = ${spurious}: TLC exit ${rc}, expected ${want}"
          broken=$((broken + 1))
        fi
        states="$(grep -Eo '[0-9,]+ distinct states found' "${cfg%.cfg}.out" | tail -n1 | cut -d' ' -f1)"
        if [[ $rc -eq 0 ]]; then
          if [[ $spurious == FALSE ]]; then
            states_false="$states"; passing=$((passing + 1))
          elif [[ "$states" == "$states_false" ]]; then
            same_states=$((same_states + 1))
          fi
        fi
      done
      if ((p + c > 2 * k)); then
        [[ -z "$smallest" || $((p + c)) -lt $smallest ]] && smallest=$((p + c))
      elif ((p + c > largest_free)); then
        largest_free=$((p + c))
      fi
    done
  done
  echo "capacity $k: smallest deadlocking thread count ${smallest}, deadlock-free up to ${largest_free} threads"
done
echo "${runs} TLC runs, ${broken} broken the rule 'deadlock iff producers + consumers > 2 x capacity'"
echo "deadlock-free configurations: ${same_states} of ${passing} have the same distinct states with and without spurious wakeups"
[[ $broken -eq 0 ]]
