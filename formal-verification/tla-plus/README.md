# tla-plus: model-checking real concurrent code

Two small concurrent programs, one in **Rust** and one in **Go**. Each has a bug that the usual tests
pass. Each has a TLA+ specification in which the TLC model checker finds that bug in about a second,
a fix that TLC then verifies, and a bridge from the specification back to the running code. That
bridge is what makes the green result about the code, and not only about a drawing of it.

| | [`rust-blocking-queue/`](./rust-blocking-queue/) | [`go-worker-pool/`](./go-worker-pool/) |
| --- | --- | --- |
| The code | A bounded blocking queue from `Mutex` + `Condvar`, several producers and consumers | A worker pool whose `Submit` races `Shutdown` |
| The bug | One `Condvar` for both sides + `notify_one`: a producer can wake a producer. The wakeup is lost and every thread ends up asleep (**deadlock**) | Check `closed`, unlock, *then* send: `Shutdown` slips in between and closes the channel (**panic: send on closed channel**). A second design built on `select` never panics but **loses accepted jobs** |
| TLC's counterexample | 8 steps, after exploring 22 distinct states | 4 steps, after exploring 77 distinct states |
| The fix, verified | Two `Condvar`s (`not_full` / `not_empty`): no deadlock, no lost wakeup, system-wide progress, with spurious wakeups modelled; up to 10 threads (81,767 states) | `Shutdown` waits for in-flight senders before `close`: no panic, every accepted job handled exactly once, no deadlock, no goroutine leak; up to 4 clients, 2 `Shutdown` callers and 2 workers (137,224 states) |
| Spec style | Plain TLA+ actions | PlusCal (an algorithm language that compiles to TLA+) |
| Spec ↔ code bridge | **Trace validation**: the real queue logs its critical sections and TLC checks that the log is a behaviour of the spec | **Counterexample replay**: test hooks force TLC's interleaving on the real pool, which really panics (buggy) or doesn't (fixed) |

## Quick start

```sh
cd formal-verification/tla-plus
make all       # Rust + Go test suites, then every TLC model (downloads tla2tools.jar once)
```

Requirements: Java 11+ (for TLC), Rust with edition 2024 support (1.85+), Go 1.24+, `make`, `curl`
and `bash`. No crates or Go modules beyond the standard libraries.

Each project also has its own `make` targets (`make trace`, `make demo` and `make sweep` in Rust;
`make replay` and `make demo` in Go); see its README.

## Why model checking for concurrency

A test runs **one** interleaving of the threads: whichever the scheduler picked that time. A stress
test runs many, but all of them come from the same few habits of the same scheduler:

- The Rust deadlock needs more threads than twice the queue's capacity, *and* a particular order of
  wakeups. With 4 producers, 3 consumers and capacity 3, the real queue hung in at most 5 of 1,000
  stress trials, often in none. With 5 producers, 4 consumers and capacity 4 it never hung in 3,000.
  TLC finds the 46-step path to the first deadlock in about a second, and the 77-step path to the
  second in about nine seconds.
- The Go panic needs `Shutdown` to land in a window a few instructions wide. Stress runs hit it in
  under 1% of runs with an idle queue, and in roughly a fifth to a third of runs with a full one.
  A racing test *written for this bug* catches it, but someone first has to guess that shape of
  test. TLC derives the 4-step schedule from the design alone. It then proves that the fix is
  safe on every interleaving of the model, which no amount of testing can do.

TLC, the TLA+ model checker, does not sample. It enumerates **every** reachable state of a finite
model, for example 2 producers, 1 consumer and capacity 1, and checks the properties in each one. It
checks invariants ("nothing is ever in state X") and temporal properties ("every accepted job is
eventually handled"). When a property fails, TLC prints the shortest sequence of steps that breaks it.

## How the verification is wired

[`tools/tla.sh`](./tools/tla.sh) downloads a pinned, sha256-verified `tla2tools.jar` (v1.7.4, TLC
2.19) into `.tools/` and wraps TLC and the PlusCal translator:

```sh
tools/tla.sh tlc  rust-blocking-queue/spec/BlockingQueue.tla rust-blocking-queue/spec/Buggy_P2C1K1.cfg
tools/tla.sh check rust-blocking-queue/spec go-worker-pool/spec   # what `make verify` runs
tools/tla.sh pcal go-worker-pool/spec/WorkerPoolFixed.tla          # re-translate PlusCal
```

Every model (`.cfg`) declares what TLC must report for it:

```tla
\* SPEC: BlockingQueue.tla
\* EXPECT: deadlock
\* WHY: the smallest deadlock: 2 producers + 1 consumer > 2 x capacity 1; TLC's 8-step trace is the headline counterexample
```

`check` fails whenever the observed outcome is different from the declared one. That applies in both
directions: a fixed design that TLC starts rejecting fails the run, and so does a buggy design, a
mutation or a sanity probe that TLC **stops** catching. The second direction is what keeps the green
results honest. A property that can never fail proves nothing, so each project has models that must
fail: deliberately broken specs, weakened fairness, and "can this state even be reached?" probes.

| `EXPECT` | TLC reports | exit code |
| --- | --- | --- |
| `pass` | no error | 0 |
| `deadlock` | a state with no enabled step | 11 |
| `safety [Inv]` | an invariant is violated (optionally, which one) | 12 |
| `liveness` | a temporal property is violated | 13 |
| `action` | an action property is violated, e.g. a refinement `[][A]_v` | 13 |
| `assert` | a PlusCal/TLC `Assert` fails | 14 |
| `accepted Inv` / `rejected` | trace validation: the log matched / no behaviour matches it | 12 / 0 |

## Two ways to connect a spec to code

A TLA+ spec is a model of the code, not the code. If the model is wrong, a verified model says
nothing about the program. The two projects show two complementary techniques for closing that gap:

- **Trace validation** (Rust). The program records what it did, and TLC checks that the recording is
  one of the behaviours the spec allows. The check runs on real executions, including the real hang
  of the buggy queue, which TLC maps step by step onto its own deadlock trace. It also caught
  something the first spec left out: real runs of the fixed queue sometimes need a *spurious
  wakeup* to explain them. The technique comes from Cirstea, Kuppe, Loillier and Merz,
  [*Validating Traces of Distributed Programs Against TLA+ Specifications*](https://arxiv.org/abs/2404.16075)
  (SEFM 2024).
- **Counterexample replay** (Go). TLC's counterexample is a schedule. Test-only hooks, in the style
  the Go standard library uses (`testHookXxx` variables), force exactly that schedule onto the real
  pool, deterministically. The replay turns "the model says it can panic" into a failing test, and
  shows that the fixed pool, driven through the same schedule, does not panic.

## Limits, stated plainly

- **Bounded models.** TLC proves the properties for the constants in each `.cfg`, not for every
  thread count. The small-scope hypothesis says most concurrency bugs show up with a few threads,
  and here both bugs need only three threads or goroutines. But that is an empirical rule, not a
  proof. TLAPS (the TLA+ proof system) or Apalache (a symbolic checker) can go further.
- **Abstraction.** Each spec models one critical section, or one channel operation, as a single step,
  and each README argues why that neither hides nor invents bugs. The Go project also machine-checks
  that argument with a refinement.
- **Fairness is an assumption.** Liveness ("eventually ...") only holds under fairness assumptions
  about the scheduler, which each README states and justifies. The Rust README also shows what does
  **not** hold (a single thread can starve) and why.
- **Below the lock.** TLA+ here assumes sequentially consistent memory under a mutex. Weak memory
  orderings and atomics are the job of tools such as [Loom](https://github.com/tokio-rs/loom).

## Further reading

- Leslie Lamport, [*Specifying Systems*](https://lamport.azurewebsites.net/tla/book.html) and the
  [TLA+ home page](https://lamport.azurewebsites.net/tla/tla.html).
- Hillel Wayne, [*Learn TLA+*](https://learntla.com/), the gentlest introduction to PlusCal.
- Markus Kuppe, [BlockingQueue](https://github.com/lemmy/BlockingQueue): the Java tutorial the
  Rust demo is based on, one concept per commit.
- [TLA+ examples](https://github.com/tlaplus/Examples), a large collection of specifications.
