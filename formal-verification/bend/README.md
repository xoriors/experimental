# bend — a verified, parallel tree library

A small demo of [Bend 2](https://bend-lang.com/) set up the way its site
suggests: a human writes the rules in `LAWS.bend`, the code and its proofs go
in `tree.bend` and `PROOF.bend`, and `bend PROOF.bend` refuses to pass until
every rule is **proven**, for every possible input. Tests only check the inputs
you thought of.

The same code then compiles to a native binary that runs the tree functions in
parallel on all cores.

```
tree.bend    the code: a Nat tree with parallel size / sum / mirror / flatten
LAWS.bend    the spec: 6 laws about those functions (human-owned)
PROOF.bend   the proofs of those laws, plus 10 helper lemmas
main.bend    a runnable program: builds a tree of 2^depth leaves, prints results
AGENTS.md    the "use Bend" instructions from bend-lang.com, for coding agents
```

## Run it

```bash
curl -fsSL https://bend-lang.com/install.sh | sh    # installs to ~/.bend
export PATH="$HOME/.bend/bin:$PATH"

bend PROOF.bend             # -> All terms check.
bend main.bend              # check, then run (depth 14 = 16 384 leaves)
bend main.bend -o main      # native binary via clang
./main 20                   # 1 048 576 leaves, ~0.1 s on 4 cores
./main 20 --threads 1       # same thing on one core, ~2x slower
bend main.bend -o main.js   # or a JS build: node main.js 12
```

Output of `./main 20`:

```
depth         = 20
leaves        = 1048576
sum           = 549756338176
sum (flatten) = 549756338176
sum (mirror)  = 549756338176
```

`549756338176` is `n(n+1)/2` for `n = 2^20`, as expected: the leaves count
`1, 2, 3, …`. `Nat` is arbitrary precision, so it doesn't wrap at 2^32.

## The laws

| Law | Says |
| --- | --- |
| `mirror_involutive` | `mirror(mirror(t)) == t` |
| `size_mirror` | mirroring keeps the leaf count |
| `sum_mirror` | mirroring keeps the total |
| `size_flatten` | `length(flatten(t)) == size(t)` |
| `sum_flatten` | the **parallel** tree sum equals the **sequential** list sum |
| `flatten_mirror` | `flatten(mirror(t)) == reverse(flatten(t))` |

The proofs needed lemmas Base doesn't ship: `x + 0 = x`, `1 + (a + b) = a + (1 + b)`,
commutativity and associativity of `Nat.add`, and six facts about `length`,
`append` and Base's accumulator-style `reverse`. They are all in `PROOF.bend`, all by
induction.

## Does the gate actually catch bugs?

Yes. Two bugs injected into `tree.bend` by hand:

- `flatten` drops the right subtree (`append(a, Nil{})`) → rejected at
  `size_flatten`, with the expected and observed equations printed.
- `mirror` forgets to swap (`Node{a, b}`) → rejected at `size_mirror`.

The second one taught the most useful lesson here: **a proof is only as good
as the laws.** The first four laws are all *true* for a `mirror` that does
nothing, so an agent could legitimately re-prove them for the buggy version.
That's why `flatten_mirror` exists: it says what mirror is *for*, and no
identity function satisfies it. Write the law that fails for the lazy answer.

## What it's like to work with Bend

Notes from writing this, in the order they came up.

**Getting started is quick.** The installer is a readable shell script that
checks a sha256 and writes only to `~/.bend`. `bend guide` prints the whole
language in ~600 lines, and it's enough: everything here came from the guide
and `bend base <Name>`.

**It feels like Python on Haskell on Rust.** Python syntax, Haskell/Lean
semantics (pure, `do` blocks for IO), and Rust-like resource tracking. Values
are *affine* by default (used at most once), which comes up in proofs too:
proof terms are live code, so calling a lemma twice with the same variable
fails with `consumed more than once`. Fixes, in order of preference:

- make lemma arguments you don't induct on **erased** (`for -b: Nat`): they
  vanish at runtime, so using them doesn't count;
- mark a law parameter reusable (`for +b: Nat`) or a pattern field
  (`case Node{+l, +r}`), which is legal for `Data` types.

Lists have a quantity too: `List<Nat>` is `List<&1, Nat>`, which can't be
copied. Changing `flatten` to return `+List<Nat>` (`List<&2, Nat>`) made
every list lemma easy.

**Proofs are just functions.** No tactics. `{==}` is reflexivity, a recursive
call is the induction hypothesis, and `%e : P` rewrites. The rule that
matters: for `e : {a == b}`, `P` is the *current* goal with `_` where `b`
sits, and the goal becomes `P` with `a` there. I got the direction wrong on
the very first proof; the error printed both sides and the fix was obvious.
After that, a good habit was to orient lemmas so the thing you want to get rid
of is on the **right**, and to name long subterms with erased lets
(`-lhs = …`) so the `P`s stay readable.

**Error messages are excellent.** Every failure shows expected vs. observed
terms, the context, and the source line. An open law is reported as
`N TODOs found`, so `LAWS.bend` alone is a checklist.

**Parallelism is free to write.** `a b = sum(l) sum(r)` is the whole API.
It didn't get in the way of the proofs: the checker sees through parallel
lets as plain lets.

**Rough edges** (Bend says it is young):

- `bend main.bend` (check + run in one step) crashes with
  `memory fault (machine stack overflow?)` once a list is about 32k elements
  long (depth 15), because `list_sum` and Base's `List.append`
  aren't tail-recursive. The native binary handles 1M+ leaves fine, so use
  `-o` for anything big.
- Base has no `Nat` arithmetic lemmas yet (it proves only three `max`/`>=`
  facts), so the first hour is re-proving school algebra.
- Constructors of an imported type must be qualified in patterns
  (`case T.Leaf{v}`), and error messages print the module's file name
  (`tree.Node`) rather than its alias.
- No `if` yet: `match` on `True{}` / `False{}`.
