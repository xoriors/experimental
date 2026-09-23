# formal-verification

A small TypeScript library whose test suite is backed by **Lean 4 proofs**. Each function has
a reference model written in Lean, the important properties of that model are proved as
theorems, and the same model is compiled into a native **oracle** that the TypeScript tests
query thousands of times per run. When the TypeScript and the proven model agree on every
random input, the theorems carry over to the TypeScript on those inputs.

```
 lean/Verified/*.lean                               src/*.ts
 ┌──────────────────────────────┐                  ┌──────────────────────┐
 │ model   (def insertionSort)  │                  │ implementation       │
 │ theorems (sorted, perm, ...) │                  │ (merge sort, ...)    │
 └──────┬──────────────┬────────┘                  └──────────┬───────────┘
        │ lake build   │ lake build                           │
        ▼              ▼                                      ▼
  Lean kernel     oracle (native)  ◄── stdin/stdout ──►  vitest + fast-check
  checks every    answers from the                       same random input to both;
  proof, audits   proven definitions                     any difference fails the test
  the axioms
```

You cannot prove things about TypeScript source directly: there is no formal semantics of
TypeScript to prove them in. So the proofs live on a model, and **differential testing** is
the bridge between the model and the real code. This is the approach AWS takes for the
[Cedar](https://github.com/cedar-policy/cedar-spec) policy language, which pairs a Lean model
and proofs with differential random testing of the production Rust. Here it is, small enough
to read in one sitting.

## What is proven

Every theorem below is checked by the Lean kernel on every `pnpm test`. There is no `sorry`
anywhere, and `lean/Audit.lean` fails the build unless all 58 theorems under `Verified`
(including the equation lemmas Lean generates) use only Lean's three standard axioms. That
rules out unfinished proofs, `native_decide`, and any axiom added to force a proof through.

| TypeScript | Lean model | Theorems |
| --- | --- | --- |
| `sort` (merge sort) | `Sorting.insertionSort` | `insertionSort_sorted`: output is ascending · `insertionSort_perm`: output is a permutation of the input · `sorted_unique`: two sorted lists with the same elements are equal · `eq_insertionSort`: **any** function that sorts and permutes *is* `insertionSort` · `insertionSort_idem` |
| `binarySearch` | `BinarySearch.search` | `search_sound`: a returned index holds the target, even on unsorted input · `search_complete` and `search_eq_none_iff`: on sorted input, `-1` exactly when absent · `search_after_sort`: search composed with the verified sort finds exactly the original elements · termination (Lean refuses the definition without it) and in-bounds reads (the model cannot even express an out-of-bounds read) |
| `encode` / `decode` | `RunLength.encode` / `decode` | `decode_encode`: round trip · `encode_canonical`: no empty runs, no mergeable neighbours · `encode_decode`: canonical runs round-trip too, so the encoding is a bijection and unique · `encode_length_le` |
| `transfer` / `settle` | `Ledger.transfer` / `settle` | `transfer_sum` and `settle_sum`: money is conserved by every transfer and every batch · `transfer_valid` and `settle_valid`: balances stay non-negative **and at most `Number.MAX_SAFE_INTEGER`**, so JS arithmetic on them stays exact · `transfer_length` and `settle_length` · `transferNoGuard_mints_money`: without the same-account guard, `[10]` becomes `[15]`, checked by the kernel |

Two modelling choices are worth pointing out:

- **The sort model is a different algorithm.** The TypeScript is a bottom-up merge sort;
  the model is an insertion sort, which is much easier to prove. That is sound because
  `eq_insertionSort` says every correct sort has the same output, so comparing the two
  element by element loses nothing.
- **The ledger models JavaScript numbers.** Lean's `Int` is unbounded and a JS `number` is
  a double. Rather than ignore the gap, the model includes `2^53 - 1` as `maxSafe`: amounts
  past it are rejected (`Number.isSafeInteger`), and so is any transfer that would push a
  balance past it. The theorems then show balances never leave the range where JS integers
  are exact, and the generators deliberately produce values at and beyond that edge.

## The tests

`pnpm test` runs `lake build` (every proof, the axiom audit, the oracle), then five vitest
files:

| File | What it checks |
| --- | --- |
| `tests/theorems.test.ts` | Each Lean theorem restated as a fast-check property of the TypeScript, named after the theorem. Needs no Lean. |
| `tests/differential.test.ts` | TypeScript against the Lean oracle, 2,000 random inputs per function. The same array, the same index, the same error. |
| `tests/mutants.test.ts` | Tests for the tests: six realistic bugs in `mutants/`, each of which the oracle must catch. |
| `tests/generators.test.ts` | The generators reach every branch: each transfer outcome, found and missed searches, long runs. Thousands of passing runs prove little if they all hit `InvalidAccount`. |
| `tests/outside-the-model.test.ts` | What the proofs cannot cover (input mutation, NaN, fractional ids), tested conventionally and kept separate on purpose. |

### Mutation results

Every mutant is killed by the oracle, and fast-check shrinks the failure to a small
counterexample. A typical run:

| Mutant | Bug | Shrunk counterexample | Restated theorems that also catch it |
| --- | --- | --- | --- |
| `sort-drops-tail` | merge never copies the right half's leftovers | `[0, 0]` | `insertionSort_sorted`, `_perm`, `_idem` |
| `search-closed-bound` | `hi = mid - 1` inside a half-open loop | `[0, 0, 0, 1, 2]`, target `1` | `search_eq_none_iff`, `search_after_sort` |
| `rle-last-run` | final run never pushed | `[0]` | `decode_encode`, `encode_decode` |
| `ledger-self-transfer` | no same-account guard; both sides computed from the old array | `[0, 0]`, 0 → 0, 0 | `transfer_sum` |
| `ledger-no-overflow` | no overflow guard | `[2^53 − 813, 813]`, 1 → 0, 813 | `transfer_sum`, `transfer_valid` |
| `ledger-guard-order` | amount checked before same-account | `[0, 0]`, 0 → 0, `2^53` | **none** |

The last row is the point of the oracle. Reordering two guards changes which error a caller
sees, but money is never at risk, so every restated theorem still passes. Only a comparison
against a model that pins down the exact behaviour notices.

## What this does and does not guarantee

- **The proofs are about the Lean model.** The link to the TypeScript is testing: very
  strong evidence on the inputs tried, not a proof for all inputs.
- **The model has to be faithful.** `BinarySearch.search` copies the loop step for step, so
  the tests can demand the same index even with duplicates. The sort and RLE models are
  shaped differently from the TypeScript; the differential tests are what connect them.
- **Trusted base:** the Lean kernel (for the proofs), the Lean compiler (for the oracle),
  the unproven parsing and printing in `lean/Oracle.lean` (pinned by `#guard` examples that
  run at build time), Node, and the generators.
- **Outside the model** entirely: aliasing and mutation, `NaN`, non-integer ids and amounts.
  Those have ordinary tests in `tests/outside-the-model.test.ts`.

## Running it

Needs Node 22+, pnpm, and [elan](https://github.com/leanprover/elan), the Lean toolchain
manager:

```sh
curl https://raw.githubusercontent.com/leanprover/elan/master/elan-init.sh -sSf | sh
```

Then:

```sh
pnpm install
pnpm test        # lake build (proofs + audit + oracle), then vitest
pnpm typecheck
pnpm oracle      # talk to the oracle by hand: type `sort 3 1 2`, get `1 2 3`
```

The first `lake build` makes elan fetch the toolchain pinned in `lean/lean-toolchain`
(Lean 4.34.0). There is no Mathlib dependency, only Lean core, so after that a clean build
of every proof and the oracle takes about three seconds.

To see the proofs doing their job, delete the overflow guard from `Ledger.transfer` in
`lean/Verified/Ledger.lean`: the build fails, because the safety proof no longer goes through.

## Layout

```
src/                  the TypeScript library (sort, search, rle, ledger)
mutants/              one realistic bug each, for tests/mutants.test.ts
tests/
  oracle.ts           client for the Lean oracle: one long-lived process, line protocol
  arbitraries.ts      fast-check generators, tuned to reach every branch
  theorems.ts         Lean theorems restated as properties of an implementation
  differential.ts     "TypeScript and Lean agree" properties
  *.test.ts           the five suites above
lean/
  Verified/           models and proofs: Sorting, BinarySearch, RunLength, Ledger
  Oracle.lean         the oracle executable and its protocol
  Audit.lean          fails the build on sorry, native_decide or custom axioms
  lakefile.toml       warningAsError, so a `sorry` is a build failure too
```

## Adding a verified function

1. Write the TypeScript in `src/`.
2. Model it in `lean/Verified/`, state what should be true, prove it.
3. Add a command to `lean/Oracle.lean`, with a `#guard` example or two.
4. Add a method to `tests/oracle.ts`, a differential property, and the restated theorems.
5. Write a mutant with a plausible bug and check that the oracle catches it.
