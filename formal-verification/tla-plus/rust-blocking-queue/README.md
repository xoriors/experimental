# rust-blocking-queue: a lost wakeup, found by TLC and caught on the real code

A bounded blocking queue built from `std::sync::Mutex` + `std::sync::Condvar`, shared by
several producer and consumer threads. It is the Rust rendition of the classic TLA+
"BlockingQueue" lesson (Markus Kuppe's tutorial, originally about Java `wait`/`notify`),
with three things added:

* the specs are checked against the **real Rust code** by *trace validation*: the queue
  logs its critical sections, and TLC checks each log is a behaviour of the spec;
* liveness is stated with **explicit, justified fairness**, including properties that do
  *not* hold and why;
* every "it holds" is backed by a model that **must fail** when the thing it guards is
  broken, so none of the green results is vacuous (true only because the situation it
  talks about never arises).

TLC is the TLA+ model checker: it explores **every** reachable state of a small, finite
model (say 2 producers, 1 consumer, capacity 1) and prints the shortest path to any
deadlock or any state that breaks an invariant. [`../README.md`](../README.md) introduces
TLA+, TLC and the shared `tools/tla.sh`; this README assumes only that.

Everything here was run; every number and every TLC excerpt below was observed on this
machine (4 cores shared with other jobs, TLC 2.19 / tla2tools v1.7.4, Java 21, Rust 1.94.1).

## Quick start

Needs Java 11+ (for TLC), Rust 1.85+ (edition 2024) with `clippy` and `rustfmt`, `make`,
`bash` and `curl`. `../tools/tla.sh` downloads a pinned, checksum-verified
`tla2tools.jar` on first use. From this directory:

```sh
make all      # cargo fmt --check, clippy -D warnings, cargo test; then all 51 TLC models (~1 min)
../tools/tla.sh tlc spec/BlockingQueue.tla spec/Buggy_P2C1K1.cfg   # the headline deadlock, full output
make trace    # record fresh runs of the real queues and trace-validate them with TLC
make demo     # stress the real queues under a watchdog and count hangs (~1 min)
make sweep    # the 120-size sweep behind the "2 x capacity" rule below (~6 min)
```

`make verify` / `make test` from `..` recurse into this project and its Go sibling.

## The bug in one diff

```diff
-pub struct Buggy<T> {
+pub struct Fixed<T> {
     queue: Mutex<VecDeque<T>>,
     capacity: usize,
-    cond: Condvar, // "the queue changed": producers AND consumers wait here
+    not_full: Condvar,  // producers wait here; consumers notify it
+    not_empty: Condvar, // consumers wait here; producers notify it
     ...
     fn put(&self, item: T) {
         let mut queue = self.queue.lock().unwrap();
         while queue.len() == self.capacity {
             emit(&self.tracer, Event::Wait);
-            queue = self.cond.wait(queue).unwrap();
+            queue = self.not_full.wait(queue).unwrap();
         }
         emit(&self.tracer, Event::Put(&item));
         queue.push_back(item);
-        self.cond.notify_one(); // BUG: may wake a producer instead of a consumer
+        self.not_empty.notify_one(); // only consumers wait on not_empty
     }
     // take() is the mirror image: waits on not_empty, notifies not_full
```

(Abridged from `diff src/buggy.rs src/fixed.rs`, which also shows the constructor and
`take`. `emit` is the optional trace hook, described below.)

With one Condvar for both sides, `notify_one` wakes *some* waiter, possibly one of the
same kind as the caller. A producer that wakes another producer, which finds the queue
still full and goes back to sleep, has spent the wakeup a sleeping consumer needed. Do that
a few times and every thread is asleep in `Condvar::wait`, forever. Nothing panics, nothing
races, the process just stops.

`src/notify_all.rs` is the third variant: one Condvar but `notify_all`. It is correct, and
wakes every waiter for every item.

## Why tests and race detectors miss it

**It needs more threads than twice the capacity.** `make sweep` checks the buggy spec for
every capacity 1..4 with 1..6 producers and 1..6 consumers (at most 9 threads: 120 sizes),
each with and without spurious wakeups. Every one deadlocks exactly when
`producers + consumers > 2 x capacity`:

| capacity | smallest deadlocking thread count | deadlock-free up to |
|---:|---|---|
| 1 | 3 (2P+1C or 1P+2C) | 2 threads |
| 2 | 5 | 4 threads |
| 3 | 7 | 6 threads |
| 4 | 9 | 8 threads |

This is a pattern observed over those 120 sizes, not a proof for all sizes. The usual unit
test, one producer and one consumer, can never hang (`Buggy_P1C1K1`, and the green
`the_buggy_queue_passes_the_usual_one_producer_one_consumer_test`), and neither can anything
with a realistic capacity and a handful of threads.

**Where it can hang, stress testing finds it less and less as the capacity grows.** Each
trial runs the real, uninstrumented queue with fresh threads under a watchdog
(`src/bin/demo.rs`, stall window 50-100 ms, every "hang" re-checked a second later). The
hang rate depends heavily on machine load, so the right column gives the range seen over
several runs of the buggy queue:

| configuration (items per producer) | TLC, buggy spec | real buggy queue, hung trials |
|---|---|---|
| 2 producers, 1 consumer, capacity 1 (200) | deadlock, 8 steps, under a second | 98-100 % (e.g. 295 of 300) |
| 3 producers, 2 consumers, capacity 2 (200) | deadlock, 23 steps (`Buggy_P3C2K2`) | 3 to 27 of 100 |
| 3 producers, 3 consumers, capacity 2 (200) | deadlock | 2 to 17 of 100 |
| 4 producers, 3 consumers, capacity 3 (200) | deadlock, 46 steps, 10,524 states, ~1 s | 0 to 5 of 1000 |
| 5 producers, 4 consumers, capacity 4 (1000) | deadlock, 77 steps, 393,347 states, ~9 s (`make sweep`) | 0 of 1000, in each of 3 runs |
| 1 producer, 1 consumer, capacity 1 (1000) | no deadlock (`Buggy_P1C1K1`) | 0 of 100 |

In the first configuration the fixed and notify_all queues hung in 0 of 300 trials each;
`make demo` below runs all three designs side by side. TLC finds each deadlock the same
way every time; the stress test finds the 7-thread one in a few trials out of a thousand, or
not at all, and never found the 9-thread one.

**Race detectors look for the wrong thing.** Every access to shared state happens under the
one Mutex, so there is no data race for ThreadSanitizer to report, and no lock-order cycle
for a lock-graph deadlock detector: the threads are not waiting for each other's locks,
they are waiting for a notification that was already delivered to somebody else. Anything
that executes one schedule per run (a test, a stress loop, an interpreter with a random
scheduler) sees the hang only if that schedule happens to produce it. TLC enumerates all of
them.

## Layout

```
Cargo.toml  Makefile  .gitignore  sweep.sh (make sweep)
src/lib.rs            BlockingQueue trait (new/with_tracer/put/take), Variant enum
src/buggy.rs          BUGGY:  one Condvar, notify_one
src/fixed.rs          FIXED:  not_full + not_empty, notify_one
src/notify_all.rs     one Condvar, notify_all
src/trace.rs          Tracer hook (called under the Mutex), Recorder, TLA+ log writer
src/harness.rs        producers/consumers under a watchdog (shared by the binaries)
src/bin/trace.rs      record a real run -> TLA+ module + TLC models
src/bin/demo.rs       stress the real queues and count hangs
tests/queue.rs        deterministic tests
spec/BlockingQueueCommon.tla    constants, variables, Condvar semantics, shared properties
spec/BlockingQueue.tla          spec of src/buggy.rs
spec/BlockingQueueFixed.tla     spec of src/fixed.rs
spec/BlockingQueueNotifyAll.tla spec of src/notify_all.rs
spec/BlockingQueueIfMutant.tla, BlockingQueueTransitionMutant.tla   spec-only mutants
spec/BlockingQueueDesigns.tla   one design, chosen by a constant (for the two wrappers below)
spec/BlockingQueueWorkload.tla  finite workloads: does every balanced run finish?
spec/TraceBlockingQueue.tla     trace-validation spec
spec/Trace*.tla                 committed logs (4 real, 3 hand-corrupted)
spec/*.cfg                      51 TLC models, each with SPEC/EXPECT/WHY headers
```

## The spec

Plain TLA+ actions (the sibling Go project uses PlusCal). One module per design, all
extending `BlockingQueueCommon.tla`, and the diffs mirror the code diffs: below the header
comment, `diff BlockingQueue.tla BlockingQueueFixed.tla` changes only Condvar and struct
names, as in the Rust diff, and `diff BlockingQueue.tla BlockingQueueNotifyAll.tla` changes
only the struct name and `NotifyOne` -> `NotifyAll` (`notify_one` -> `notify_all`) in `Put`
and `Take`.

<details>
<summary>The first diff, observed</summary>

```
$ cd spec && diff BlockingQueue.tla BlockingQueueFixed.tla     # after the header comment
13,14c12,13
< \* struct Buggy { cond: Condvar, .. }
< CondVars == {"cond"}
---
> \* struct Fixed { not_full: Condvar, not_empty: Condvar, .. }
> CondVars == {"not_full", "not_empty"}
16c15
< \* Buggy::with_tracer(capacity, ..): an empty queue, nobody waiting.
---
> \* Fixed::with_tracer(capacity, ..): an empty queue, nobody waiting.
21c20
< \*     queue.push_back(item);  self.cond.notify_one();
---
> \*     queue.push_back(item);  self.not_empty.notify_one();
25c24
<           /\ NotifyOne("cond")
---
>           /\ NotifyOne("not_empty")
27c26
< \* fn put, the loop condition is true:  queue = self.cond.wait(queue)
---
> \* fn put, the loop condition is true:  queue = self.not_full.wait(queue)
30c29
<               /\ Wait(p, "cond")
---
>               /\ Wait(p, "not_full")
34c33
< \*     queue.pop_front();  self.cond.notify_one();
---
> \*     queue.pop_front();  self.not_full.notify_one();
38c37
<            /\ NotifyOne("cond")
---
>            /\ NotifyOne("not_full")
40c39
< \* fn take, the loop condition is true:  queue = self.cond.wait(queue)
---
> \* fn take, the loop condition is true:  queue = self.not_empty.wait(queue)
43c42
<                /\ Wait(c, "cond")
---
>                /\ Wait(c, "not_empty")
```
</details>

### State

| variable | models |
|---|---|
| `buffer` | the `VecDeque<T>` inside the Mutex; an item is the id of the producer that put it |
| `waiting[cv]` | the set of threads blocked in `cv.wait(guard)`, one entry per Condvar |

A thread not in any wait set is *runnable* (awake): running, or contending for the Mutex.

### Granularity: one step = one critical section

A step is everything a thread does between getting the Mutex (`lock()`, or `wait()`
returning) and giving it up (the guard is dropped, or `wait()` is called). Treating a
lock-protected block as one atomic step (Lipton's *reduction*) loses no behaviour as long
as no shared state is touched outside the lock. Here that is true of all queue state, and
`notify_*` is called while the guard is still alive; the one exception is the Condvar's own
futex word, which `wait()` reads under the lock but sleeps on after unlocking. A
notification that lands in that window makes the waiter return although nobody picked it:
an **extra wakeup**, which the spec models as a spurious wakeup (below). So atomic critical
sections *plus* spurious wakeups (`Spurious = TRUE`) over-approximate the code, and
`Spurious = FALSE` is an idealised Condvar. The `while` loop needs no program counter: a
thread that returns from `wait()` re-tests the condition in a new critical section, which is
the same step a fresh call takes.

### Code <-> spec mapping

| code (`src/fixed.rs`; `buggy.rs`/`notify_all.rs` differ only in their Condvar calls) | spec action | trace event |
|---|---|---|
| `Fixed::with_tracer`: empty queue, no waiters | `Init` | |
| `put`: `while queue.len() == self.capacity` false; `push_back`; `self.not_empty.notify_one()` | `Put(p)` | `Event::Put(&item)` |
| `put`: loop condition true; `self.not_full.wait(queue)` | `PutWait(p)` | `Event::Wait` |
| `take`: `while queue.is_empty()` false; `pop_front`; `self.not_full.notify_one()` | `Take(c)` | `Event::Take(&item)` |
| `take`: loop condition true; `self.not_empty.wait(queue)` | `TakeWait(c)` | `Event::Wait` |
| `Condvar::wait` returns without a notification | `SpuriousWakeup` (if `Spurious`) | not logged |
| `Condvar::notify_one` | `NotifyOne(cv)` (inside `Put`/`Take`) | not observable |
| `Condvar::notify_all` (`src/notify_all.rs`) | `NotifyAll(cv)` | not observable |
| `Mutex` | atomicity of each step + fairness `F1`, `F2` | log order |
| producer / consumer thread loops | `Producer(p)`, `Consumer(c)`, `Next` | thread name |

Every action carries a comment naming the function and the line it models.

### Primitive semantics, from the std docs (Rust 1.94)

* `Condvar::wait`: "atomically unlock the mutex specified (represented by guard) and
  block the current thread" -> `Wait(t, cv)` adds `t` to `waiting[cv]` in the same step
  that ends the critical section.
* `Condvar::notify_one`: "If there is a blocked thread on this condition variable, then it
  will be woken up ... Calls to `notify_one` are not buffered in any way." -> `NotifyOne`
  removes an **arbitrary** waiter (TLC tries each one) and does nothing if there is none:
  a notification with no waiter is lost, not saved.
* `Condvar::notify_all`: "Wakes up all blocked threads on this condvar." -> empties the set.
* `Condvar::wait`: "this function is susceptible to spurious wakeups" -> `SpuriousWakeup`
  removes any waiter, under the constant `Spurious`. Not hypothetical: std's futex Condvar
  reads a counter before unlocking and `futex_wait`s on it, so a notification landing in
  between makes that waiter return **and** wakes whoever `futex_wake` picks (the extra
  wakeup above). Trace validation caught it happening in a real run (below).
* `Mutex`: std promises mutual exclusion and nothing about fairness; the futex
  implementation lets an arriving thread take the lock ahead of one that was just woken
  ("barging"). That is why the spec has no Mutex variable, only fairness assumptions.

### Properties

Safety (`BlockingQueueCommon.tla`), checked as invariants:

* `TypeOK`: types. `BoundedBuffer`: `Len(buffer) <= Capacity`.
* `NoDeadlock`: not every thread is blocked in `wait()`. With `Spurious = FALSE` this is
  exactly TLC's built-in deadlock check (a runnable thread always has a step). With
  `Spurious = TRUE` a spurious wakeup is always enabled while anybody waits, so TLC's own
  check is blind: `Buggy_SpuriousDeadlockCheckBlind` **passes** although the design
  deadlocks, and the same model with `NoDeadlock` added (`Buggy_Spurious`) catches it.
* `ConsumerAwake` / `ProducerAwake` (no lost wakeup): while any consumer is blocked, every
  queued item has its own awake consumer (`Len(buffer) <=` the number of runnable
  consumers); while any producer is blocked, every free slot has its own awake producer.
  The count matters. "*Some* consumer is awake" is too weak: in a spec whose threads never
  quit, one awake consumer drains everything, so a design that leaves a second consumer
  asleep next to a second item passes it, and passes `NoDeadlock` and `Progress` too
  (`Mutant_NotifyOnlyOnTransition`, below). The buggy design breaks `ConsumerAwake` two
  steps before it deadlocks (`Buggy_LostWakeup`), and `ProducerAwake` in the mirror
  configuration (`Buggy_LostWakeupProducer`).

Liveness uses three pieces of temporal logic: `[]<>A` ("always eventually A": A happens
infinitely often); `WF_vars(A)`, *weak fairness* (if A stays enabled without a break, it
eventually happens); and `SF_vars(A)`, *strong fairness* (if A is enabled again and again,
even with breaks, it eventually happens). Each liveness property is checked under an
explicit fairness assumption (identical text in all three design modules):

| fairness | meaning | justification |
|---|---|---|
| **F1** `LockFair` = `WF_vars(CS)` | if some thread wants the Mutex, some thread gets it | the least any lock gives: a free lock that is wanted gets taken. std's Mutex promises no fairness beyond that |
| **F2** `ThreadFair` = `WF_vars(Producer(t))`, `WF_vars(Consumer(t))` for each thread | a runnable thread eventually runs its next critical section | the OS schedules every runnable thread and the lock does not bypass one thread forever; it does **not** promise that the queue is in the right state when the thread gets there. Strong fairness on the same actions (`ThreadStrongFair`, the most any lock can promise) adds nothing: a runnable thread's step stays enabled until it takes it |
| **F3** `StrongFair` = F2 + `SF_vars(Put(p))`, `SF_vars(Take(c))` | a thread that is again and again *able* to complete its put/take eventually does | hypothetical, and **not a lock property**: it depends on the queue's state at the moment the thread runs, so no lock provides it, not even a FIFO one. Used only to show what starvation freedom would need |

Spurious wakeups get no fairness: they may happen, never must.

* `Progress`: items keep going in and coming out (`[]<><<Put>>` and `[]<><<Take>>`). Holds
  for the fixed and notify_all designs under F2 with spurious wakeups. Under F1 it holds
  for the idealised Condvar (`Spurious = FALSE`), but with spurious wakeups only if they
  eventually stop: `ProgressIfSpuriousStops` = `(<>[][~SpuriousWakeup]_vars) => Progress`.
* `NoStarvation`: *every* producer keeps putting and *every* consumer keeps taking. Does
  **not** hold for the fixed queue, not even under F3; holds for notify_all only under F3.
* `Terminates` (`BlockingQueueWorkload.tla`): with finite, balanced quotas every thread
  returns; `NoHang` is the matching invariant (see abstraction 4).

### Abstractions, and why they neither hide nor invent bugs

1. **Atomic critical sections plus spurious wakeups.** Justified above: together they
   over-approximate the code. Spurious wakeups are a nondeterministic, unfair action: with
   `Spurious = TRUE` any waiter may wake at any moment, which covers every extra wakeup
   the futex implementation can produce (and more). Some models run with
   `Spurious = FALSE`, because TLC's own deadlock check works there and traces are
   shorter. What they find wrong is wrong with spurious wakeups too: a behaviour without
   spurious steps is still a behaviour, and just as fair. What they find right carries
   over for safety: the fixed and notify_all designs reach exactly the same states either
   way (checked for all seven of their safety configurations, e.g. 81,767 states for
   `Fixed_P5C5K3_Large` both ways), and `make sweep` checks the buggy design both ways.
   The one result that holds only for `Spurious = FALSE` is progress under F1
   (`Fixed_P2C1K1`, `NotifyAll_P2C1K1`), and the models say so.
2. **No Mutex variable.** Mutual exclusion is implied by (1); fairness is stated explicitly
   (F1-F3), and the models show which conclusions depend on which.
3. **Data abstraction.** An item is its producer's id. No control decision in the code
   depends on an item's value (only on `len()`), so the abstraction removes no behaviour;
   keeping the producer id lets trace validation check FIFO order, at the takes where
   items of two or more producers are queued.
4. **Threads loop forever in the design modules.** Real threads (tests, `trace`, `demo`)
   do a fixed number of operations; each such run is a prefix of a spec behaviour, so
   safety properties carry over. Whether a program whose threads *return* can strand the
   rest is a separate question, because a returned thread no longer drains the queue.
   `BlockingQueueWorkload.tla` asks it of the unchanged design actions: every thread gets a
   quota, as in `src/harness.rs`, and TLC checks that every balanced run (as many takes as
   puts) finishes. It does for the fixed and notify_all designs; the buggy design and the
   notify-on-transition mutant hang (`Workload_*`). An unbalanced workload (more takes than
   puts) hangs by construction; the harness always balances.
5. **`notify_one` wakes an arbitrary waiter.** This is what std promises. Linux's futex
   queue is roughly FIFO, so some *liveness* counterexamples (a waiter skipped forever, as in
   `Fixed_StarvationStrongFair`) are allowed by std but unlikely on Linux; safety results
   are unaffected (a superset of behaviours).
6. **Not modelled:** Mutex poisoning (no code panics while holding the lock), `wait_timeout`
   (unused), several queues, the memory model below the Mutex (all shared data is behind
   it), and std's own futex code, which is trusted.
7. **Bounded models.** TLC checks the listed constants only; the *small-scope hypothesis*
   (most bugs show up in small instances) is the argument for going no bigger. The
   "deadlocks iff threads > 2 x capacity" rule is an observation over 120 sizes, not a
   theorem.

## Models (`make verify`)

Each `.cfg` names its module (`SPEC`), the outcome TLC must report (`EXPECT`) and why
(`WHY`). `../tools/tla.sh check` fails if any model's outcome differs, so a buggy design or
a mutant that TLC *stops* catching is an error too. Outcomes are `pass`, `deadlock`,
`safety <Invariant>` (that invariant is violated), `liveness` (a temporal property is
violated), plus two aliases for trace models: `accepted <Invariant>` and `rejected` (see
[Trace validation](#trace-validation-the-bridge-from-the-code-to-the-spec)). Configurations
below: `2P 1C K=1` = 2 producers, 1 consumer, capacity 1; `spur` = `Spurious = TRUE`.

**The buggy design** (`BlockingQueue.tla`):
* `Buggy_P2C1K1` (2P 1C K=1): deadlock, the 8-step headline counterexample below.
  `Buggy_P1C2K1` (1P 2C K=1): the mirror image, a consumer wakes a consumer.
  `Buggy_P3C2K2` and `Buggy_P4C3K3`: deadlock one thread past the `2 x capacity`
  boundary, in 23 and 46 steps.
* `Buggy_LostWakeup` / `Buggy_LostWakeupProducer`: the root cause, `ConsumerAwake` /
  `ProducerAwake` violated two steps before the deadlock.
* `Buggy_Spurious` (spur): `NoDeadlock` violated; `Buggy_SpuriousDeadlockCheckBlind`, the
  same model without that invariant, passes: TLC's own deadlock check is blind here.
* `Buggy_P1C1K1` (1P 1C K=1, spur, F2) and `Buggy_P2C2K2` (2P 2C K=2, spur): pass. Why the
  usual tests are green, and the boundary itself.

**The fixed and notify_all designs**, all safety properties, and progress where a
fairness is named:
* Fixed: `Fixed_P2C1K1` (the headline configuration, `Spurious = FALSE`, F1),
  `Fixed_P2C2K1_Spurious`, `Fixed_P4C3K3_Spurious` (the configuration of `Buggy_P4C3K3`)
  and `Fixed_P4C4K3_Spurious` (spur, F2), and `Fixed_P5C5K3_Large` (10 threads, spur,
  safety only, 81,767 states). `Fixed_LockFairSpuriousStops` (spur, F1):
  `ProgressIfSpuriousStops`.
* notify_all: `NotifyAll_P2C1K1` (`Spurious = FALSE`, F1), `NotifyAll_P3C3K2_Spurious`
  (spur, F2), and `NotifyAll_StrongFair` (spur, F3): `NoStarvation` holds.

**Finite workloads** (`BlockingQueueWorkload.tla`, invariant `NoHang`, property
`Terminates`):
* `Workload_Buggy_P2C1K1`: 2 producers x 3 items, 1 consumer x 6 takes, capacity 1 (the
  workload of the real hang below): hangs, in exactly the 8 steps the real run logged.
* `Workload_Mutant_P1C2K2`: 1 producer x 2 items, 2 consumers x 1 take, capacity 2: the
  notify-on-transition mutant hangs in 5 steps, the second consumer asleep next to the last
  item.
* `Workload_Fixed_P2C1K1`, `Workload_Fixed_P1C2K2` (the same two workloads), and
  `Workload_Fixed_P3C3K2` / `Workload_NotifyAll_P3C3K2` (3 x 2 items, 3 x 2 takes,
  capacity 2), all spur, F2: every run finishes.

**What does not hold** (liveness violations, shown below): `Fixed_Starvation`,
`NotifyAll_Starvation` (F2), `NotifyAll_LockStrongFair` (strong fairness on each thread's
critical section), `Fixed_StarvationStrongFair` (F3), `Fixed_LockFairSpurious` (F1 with
spurious wakeups that never stop: the weakened-fairness mutation that shows `Progress` is
not vacuous).

**Mutations and vacuity guards** (models that must fail):
* `Mutant_IfInsteadOfWhile` (`BlockingQueueIfMutant.tla`, spec only): `if` instead of
  `while` in `put` overflows the queue in 5 steps even without spurious wakeups, via
  barging; so `BoundedBuffer` and the `while` re-test are really modelled.
* `Mutant_NotifyOnlyOnTransition` (`BlockingQueueTransitionMutant.tla`, spec only): notify
  only when the queue was empty (put) / full (take). It passes `NoDeadlock`, `Progress` and
  a "some consumer is awake" invariant; the counting `ConsumerAwake` catches it in 4 steps
  (two consumers wait, two puts, one notification).
* Reachability witnesses, each EXPECTing a violation of "this state never happens":
  `Fixed_WitnessConsumerBlockedWithItems` and `Fixed_WitnessProducerBlockedWithRoom` (the
  lost-wakeup invariants are really tested with items queued / slots free),
  `Fixed_WitnessAllProducersBlocked` (every producer blocked at once, and still no
  deadlock).
* The trace fixtures that must be rejected, each with a model pinning the record where
  matching fails (below).

<details>
<summary>Observed output of <code>make verify</code> (51 models; paths shortened)</summary>

```
$ make verify
../tools/tla.sh check spec
  ok    Buggy_LostWakeup.cfg                      expected safety ConsumerAwake, got safety; 15 distinct states, 7-state trace, 2s
  ok    Buggy_LostWakeupProducer.cfg              expected safety ProducerAwake, got safety; 11 distinct states, 6-state trace, 1s
  ok    Buggy_P1C1K1.cfg                          expected pass, got pass; 4 distinct states, 1s
  ok    Buggy_P1C2K1.cfg                          expected deadlock, got deadlock; 14 distinct states, 8-state trace, 1s
  ok    Buggy_P2C1K1.cfg                          expected deadlock, got deadlock; 22 distinct states, 9-state trace, 1s
  ok    Buggy_P2C2K2.cfg                          expected pass, got pass; 30 distinct states, 2s
  ok    Buggy_P3C2K2.cfg                          expected deadlock, got deadlock; 391 distinct states, 24-state trace, 1s
  ok    Buggy_P4C3K3.cfg                          expected deadlock, got deadlock; 10524 distinct states, 47-state trace, 2s
  ok    Buggy_Spurious.cfg                        expected safety NoDeadlock, got safety; 21 distinct states, 9-state trace, 1s
  ok    Buggy_SpuriousDeadlockCheckBlind.cfg      expected pass, got pass; 22 distinct states, 1s
  ok    Fixed_LockFairSpurious.cfg                expected liveness, got liveness; 36 distinct states, 2-state trace, 2s
  ok    Fixed_LockFairSpuriousStops.cfg           expected pass, got pass; 36 distinct states, 1s
  ok    Fixed_P2C1K1.cfg                          expected pass, got pass; 14 distinct states, 1s
  ok    Fixed_P2C2K1_Spurious.cfg                 expected pass, got pass; 36 distinct states, 2s
  ok    Fixed_P4C3K3_Spurious.cfg                 expected pass, got pass; 1600 distinct states, 1s
  ok    Fixed_P4C4K3_Spurious.cfg                 expected pass, got pass; 7092 distinct states, 4s
  ok    Fixed_P5C5K3_Large.cfg                    expected pass, got pass; 81767 distinct states, 4s
  ok    Fixed_Starvation.cfg                      expected liveness, got liveness; 14 distinct states, 4-state trace, 1s
  ok    Fixed_StarvationStrongFair.cfg            expected liveness, got liveness; 14 distinct states, 7-state trace, 1s
  ok    Fixed_WitnessAllProducersBlocked.cfg      expected safety NotAllProducersBlocked, got safety; 77 distinct states, 6-state trace, 1s
  ok    Fixed_WitnessConsumerBlockedWithItems.cfg expected safety NoConsumerBlockedWithItems, got safety; 7 distinct states, 4-state trace, 1s
  ok    Fixed_WitnessProducerBlockedWithRoom.cfg  expected safety NoProducerBlockedWithRoom, got safety; 11 distinct states, 5-state trace, 1s
  ok    Mutant_IfInsteadOfWhile.cfg               expected safety BoundedBuffer, got safety; 21 distinct states, 6-state trace, 1s
  ok    Mutant_NotifyOnlyOnTransition.cfg         expected safety ConsumerAwake, got safety; 10 distinct states, 5-state trace, 1s
  ok    NotifyAll_LockStrongFair.cfg              expected liveness, got liveness; 10 distinct states, 4-state trace, 1s
  ok    NotifyAll_P2C1K1.cfg                      expected pass, got pass; 10 distinct states, 1s
  ok    NotifyAll_P3C3K2_Spurious.cfg             expected pass, got pass; 83 distinct states, 1s
  ok    NotifyAll_Starvation.cfg                  expected liveness, got liveness; 10 distinct states, 4-state trace, 1s
  ok    NotifyAll_StrongFair.cfg                  expected pass, got pass; 83 distinct states, 2s
  ok    TraceBuggyHang.cfg                        expected accepted NoBehaviourMatchesLog, got accepted; 23 distinct states, 9-state trace, 1s
  ok    TraceBuggyHangNoSpurious.cfg              expected accepted NoBehaviourMatchesLog, got accepted; 13 distinct states, 9-state trace, 1s
  ok    TraceBuggyHangVsFixed.cfg                 expected rejected, got rejected; 27 distinct states, 1s
  ok    TraceBuggyHangVsFixedPrefix.cfg           expected safety MatchedFewerThanLimit, got safety; 24 distinct states, 10-state trace, 2s
  ok    TraceFixedExtraWakeup.cfg                 expected accepted NoBehaviourMatchesLog, got accepted; 56 distinct states, 24-state trace, 1s
  ok    TraceFixedExtraWakeupNoSpurious.cfg       expected rejected, got rejected; 13 distinct states, 1s
  ok    TraceFixedExtraWakeupNoSpuriousPrefix.cfg expected safety MatchedFewerThanLimit, got safety; 13 distinct states, 11-state trace, 2s
  ok    TraceFixedFifo.cfg                        expected accepted NoBehaviourMatchesLog, got accepted; 30 distinct states, 17-state trace, 1s
  ok    TraceFixedFifoSwapped.cfg                 expected rejected, got rejected; 28 distinct states, 1s
  ok    TraceFixedFifoSwappedPrefix.cfg           expected safety MatchedFewerThanLimit, got safety; 28 distinct states, 15-state trace, 1s
  ok    TraceFixedOk.cfg                          expected accepted NoBehaviourMatchesLog, got accepted; 60 distinct states, 23-state trace, 1s
  ok    TraceFixedOkNoSpurious.cfg                expected accepted NoBehaviourMatchesLog, got accepted; 29 distinct states, 23-state trace, 1s
  ok    TraceFixedRoleSwapped.cfg                 expected rejected, got rejected; 8 distinct states, 1s
  ok    TraceFixedRoleSwappedPrefix.cfg           expected safety MatchedFewerThanLimit, got safety; 4 distinct states, 4-state trace, 1s
  ok    TraceFixedSwapped.cfg                     expected rejected, got rejected; 28 distinct states, 1s
  ok    TraceFixedSwappedPrefix.cfg               expected safety MatchedFewerThanLimit, got safety; 26 distinct states, 10-state trace, 1s
  ok    Workload_Buggy_P2C1K1.cfg                 expected safety NoHang, got safety; 103 distinct states, 9-state trace, 1s
  ok    Workload_Fixed_P1C2K2.cfg                 expected pass, got pass; 15 distinct states, 1s
  ok    Workload_Fixed_P2C1K1.cfg                 expected pass, got pass; 133 distinct states, 2s
  ok    Workload_Fixed_P3C3K2.cfg                 expected pass, got pass; 7889 distinct states, 3s
  ok    Workload_Mutant_P1C2K2.cfg                expected safety NoHang, got safety; 18 distinct states, 6-state trace, 1s
  ok    Workload_NotifyAll_P3C3K2.cfg             expected pass, got pass; 2393 distinct states, 2s
```

For a model that fails, the distinct-state count is where TLC stopped. Counts and trace
lengths are the same on every run, liveness traces included (see below); only the times
vary.
</details>

### The headline counterexample (`Buggy_P2C1K1`, observed)

```
$ ../tools/tla.sh tlc spec/BlockingQueue.tla spec/Buggy_P2C1K1.cfg     (trimmed, annotated)
Error: Deadlock reached.
State 1: <Initial predicate>      buffer = <<>>       waiting = [cond |-> {}]
State 2: <Put p1>                 buffer = <<"p1">>   waiting = [cond |-> {}]
State 3: <PutWait p1>             buffer = <<"p1">>   waiting = [cond |-> {"p1"}]            full
State 4: <PutWait p2>             buffer = <<"p1">>   waiting = [cond |-> {"p1", "p2"}]      full
State 5: <Take c1>                buffer = <<>>       waiting = [cond |-> {"p2"}]            c1's notify_one woke p1
State 6: <TakeWait c1>            buffer = <<>>       waiting = [cond |-> {"p2", "c1"}]      empty
State 7: <Put p1>                 buffer = <<"p1">>   waiting = [cond |-> {"c1"}]            p1's notify_one woke p2, NOT c1
State 8: <PutWait p1>             buffer = <<"p1">>   waiting = [cond |-> {"p1", "c1"}]      full
State 9: <PutWait p2>             buffer = <<"p1">>   waiting = [cond |-> {"p1", "p2", "c1"}]  everybody asleep
40 states generated, 22 distinct states found, 1 states left on queue.
The depth of the complete state graph search is 9.
```

(TLC prints the action as `<Put line 22, col 11 to line 25, col 30 of module BlockingQueue>`;
the thread names are read off the state change.) State 7 is the bug: the item p1 just put
is exactly what c1 is waiting for, but the one wakeup went to p2, which re-tests
`queue.len() == capacity`, finds it true, and sleeps again. `Buggy_LostWakeup` stops right
there with `Invariant ConsumerAwake is violated` (15 distinct states).

### What does NOT hold, and why (observed counterexamples)

TLC prints a liveness counterexample as a *lasso*: a path, then a loop that repeats forever
(`Back to state N`). Which of the many valid lassos it prints depends on TLC's fingerprint
function, normally picked at random; `tools/tla.sh` pins it (`TLC_FP`, default 0), so the
excerpts below come out the same on every run. Each is trimmed to the states, with the
action labels shortened.

`Fixed_Starvation`, `NoStarvation` under F2 (barging):
```
State 1: <Initial predicate>    buffer = <<>>       waiting = [not_full |-> {}, not_empty |-> {}]
State 2: <TakeWait ...>         buffer = <<>>       waiting = [not_full |-> {}, not_empty |-> {"c1"}]
State 3: <Put ...>              buffer = <<"p2">>   waiting = [not_full |-> {}, not_empty |-> {}]
State 4: <PutWait ...>          buffer = <<"p2">>   waiting = [not_full |-> {"p1"}, not_empty |-> {}]
Back to state 1: <Take ...>
```
c1 finds the queue empty and waits; p2 puts and wakes c1; p1 finds the queue full and
waits; c1's take empties it and wakes p1, but before p1 gets the Mutex, c1 goes back to
waiting and p2 refills the queue. p1 runs a critical section every round, so F2 is
satisfied; it just always finds the queue full. `NotifyAll_Starvation` is the same story
with `notify_all`, and `NotifyAll_LockStrongFair` shows that strong fairness on each
thread's critical section, the most a lock could promise, does not help either.

`Fixed_StarvationStrongFair`, `NoStarvation` even under F3 (unfair choice of waiter):
```
State 4: <PutWait ...>   buffer = <<"p1">>   waiting = [not_full |-> {"p1", "p2"}, not_empty |-> {}]
State 5: <Take ...>      buffer = <<>>       waiting = [not_full |-> {"p1"}, not_empty |-> {}]
State 6: <Put ...>       buffer = <<"p2">>   waiting = [not_full |-> {"p1"}, not_empty |-> {}]
State 7: <PutWait ...>   buffer = <<"p2">>   waiting = [not_full |-> {"p1", "p2"}, not_empty |-> {}]
Back to state 5: <Take ...>
```
Every take's `notify_one` picks p2, never p1. p1 is never runnable, so no fairness on p1's
actions can help. `NotifyAll_StrongFair` passes: with `notify_all` every waiter becomes
runnable, and F3 then lets each one in.

`Fixed_LockFairSpurious`, `Progress` under F1 with spurious wakeups:
```
State 1: <Initial predicate>      buffer = <<>>   waiting = [not_full |-> {}, not_empty |-> {}]
State 2: <TakeWait ...>           buffer = <<>>   waiting = [not_full |-> {}, not_empty |-> {"c1"}]
Back to state 1: <SpuriousWakeup ...>
```
c1 wakes spuriously, takes the lock, re-waits, forever; F1 is satisfied because *some*
thread keeps getting the lock. `Fixed_LockFairSpuriousStops` shows F1 suffices once
spurious wakeups stop, and `Fixed_P2C2K1_Spurious` that F2 suffices with them.

## Trace validation: the bridge from the code to the spec

The technique is from Cirstea, Kuppe, Loillier and Merz, *Validating Traces of Distributed
Programs Against TLA+ Specifications* (2024).

1. **Instrumentation.** Each queue takes an optional `Box<dyn Tracer<T>>` at construction
   (`with_tracer`; `new` passes `None`, and the untraced cost is one `if let`). The queue
   calls it exactly once per critical section, **while holding the queue's Mutex**:
   `Event::Wait` just before `wait()`, `Event::Put(&item)` / `Event::Take(&item)` next to
   `push_back` / `pop_front`. Because critical sections are serialised by that Mutex, the
   order of events *is* the real order of critical sections, with no clocks involved. The
   `Recorder` tracer tags each event with the thread's name (`p1`, `c2`, ...). Its own
   Mutex is only ever taken inside the queue's, so it is uncontended and adds no lock-order
   risk.
2. **The log as TLA+.** `src/bin/trace.rs` runs real threads against the real queue and
   writes the log as a module that `EXTENDS TraceBlockingQueue` (a sequence of records, no
   JSON needed) plus the TLC model that checks it. Its header says how many takes test FIFO
   order (ran while items of two or more producers were queued).
3. **The trace spec** (`TraceBlockingQueue.tla`) instantiates the chosen design unchanged
   (via `BlockingQueueDesigns.tla`) and requires step *i* to be the design's action for log
   record *i*, taken by a thread of the right role: `put` -> `Put(t)` by a producer, with
   `t`'s own item; `take` -> `Take(t)` by a consumer, with the item equal to
   `Head(buffer)` (FIFO); `wait` -> `PutWait` or `TakeWait` by role. Unlogged
   `SpuriousWakeup` steps may occur between records. What the log cannot show (which waiter
   each `notify_one` woke, where spurious wakeups happened) TLC resolves by search.
4. **Acceptance.** TLC 2.19 rejects the `POSTCONDITION` keyword ("It was expecting a
   keyword"), so acceptance is an invariant claiming the opposite:
   `NoBehaviourMatchesLog == ~(matched = Len(Log) /\ Waiting = Blocked)`, where `Blocked`
   is the set of threads still stuck when the log ended (empty for a finished run).
   **Violated = accepted** (`EXPECT: accepted NoBehaviourMatchesLog`, an alias of `safety`),
   and TLC's "counterexample" is the matching behaviour. **Holds = rejected**
   (`EXPECT: rejected`, an alias of `pass`). A rejection can also be *pinned*: a model sets
   `MatchLimit = n` and checks `MatchedFewerThanLimit` (`matched < n`), which is violated
   exactly when records 1..n can all be matched. Deadlock checking is off, since a wrong
   guess is a dead end, not an error. Breadth-first search makes the witness the
   explanation with the fewest spurious wakeups.

### Committed fixtures (checked by `make verify`)

Real logs, untouched output of `src/bin/trace.rs`, all accepted with spurious wakeups
allowed:
* `TraceFixedOk`: `src/fixed.rs`, 2P/1C, capacity 1, 22 records (60 distinct states); also
  accepted without spurious wakeups (`TraceFixedOkNoSpurious`).
* `TraceFixedExtraWakeup`: `src/fixed.rs`, 2P/2C, capacity 1, 22 records (56 states);
  **rejected** without spurious wakeups (`...NoSpurious`), where records 1..10 match and
  record 11 cannot (`...NoSpuriousPrefix`).
* `TraceFixedFifo`: `src/fixed.rs`, 2P/1C, capacity 2, 16 records (30 states). After record
  14 the queue holds `<<"p2", "p1">>`, so the take at record 15 tests FIFO order.
* `TraceBuggyHang`: `src/buggy.rs`, 2P/1C, capacity 1, a run that **hung**, 8 records (23
  states); also accepted without spurious wakeups (`TraceBuggyHangNoSpurious`), and
  **rejected** by the fixed spec (`TraceBuggyHangVsFixed`) although all 8 records match it
  (`TraceBuggyHangVsFixedPrefix`): only the final blocked set is impossible.

Hand-corrupted copies, each **rejected**, with a `...Prefix` model showing that every record
before the corrupted one still matches:
* `TraceFixedSwapped`: `TraceFixedOk` with records 9 and 10 swapped, as a tracer that
  logged *after* unlocking could have written them; fails at record 10.
* `TraceFixedRoleSwapped`: `TraceFixedOk` with c1's take at record 4 attributed to producer
  p1; fails at record 4. (Without the role check in `Match`, TLC would accept this log by
  letting p1 wake spuriously and take the item.)
* `TraceFixedFifoSwapped`: `TraceFixedFifo` with the items of the takes at records 15 and 16
  swapped, which is what a LIFO queue would have logged; fails at the FIFO check of record 15.

The real logs were *selected*: `TraceBuggyHang` is a hang captured with `--until-hang`
(8 records, the shortest hang TLC allows; longer ones occur too); `TraceFixedOk` is one of
the 24 of 60 fixed runs in that configuration whose first 7 records equal the hang;
`TraceFixedExtraWakeup` is the first log of a search that TLC rejected without spurious
wakeups (run 87 of that search); and `TraceFixedFifo` is the first of 100 recordings with
at most 16 records and a take that tests FIFO order (42 of the 100 had such a take).

**The real hang is TLC's counterexample, record for record.** `TraceBuggyHang.tla` was
recorded from a real run of the buggy queue (2 producers x 3 items, 1 consumer, capacity
1) that hung with all three threads blocked:

```
p1 put p1 | p1 wait | p2 wait | c1 take p1 | c1 wait | p1 put p1 | p1 wait | p2 wait     (then silence)
```

That is exactly the 8 steps of `Buggy_P2C1K1` above, and of `Workload_Buggy_P2C1K1`, which
runs this very workload with quotas. Checked with `Spurious = FALSE`, TLC's witness
(observed) pins down the invisible part, which notification woke whom:

```
State 5: matched = 4  buffer = <<>>      waiting = [cond |-> {"p2"}]              c1's take woke p1
State 6: matched = 5  buffer = <<>>      waiting = [cond |-> {"p2", "c1"}]
State 7: matched = 6  buffer = <<"p1">>  waiting = [cond |-> {"c1"}]              p1's put woke p2: the lost wakeup
State 8: matched = 7  buffer = <<"p1">>  waiting = [cond |-> {"p1", "c1"}]
State 9: matched = 8  buffer = <<"p1">>  waiting = [cond |-> {"p1", "p2", "c1"}]  = Blocked: accepted
13 states generated, 13 distinct states found, 1 states left on queue.
```

`TraceFixedOk` starts with the same 7 records, but in the fixed queue p1's put at record 6
notifies `not_empty`, where only c1 waits, so c1 wakes and takes the item at record 8. That
is also why the fixed spec rejects the hang log although all 8 records match: c1 must have
been woken by that put, so the run cannot end with all three blocked.

**The real code has spurious wakeups, and the spec must allow them.**
`TraceFixedExtraWakeup.tla` is a finished, correct run of `src/fixed.rs`. Without spurious
wakeups TLC rejects it; with them, the witness (observed) places one right after record 10:

```
State 9:  matched = 8   waiting = [not_full |-> {"p2"}, not_empty |-> {}]      record 8: c1's take woke p1
State 10: matched = 9   waiting = [not_full |-> {"p2"}, not_empty |-> {"c1"}]
State 11: matched = 10  waiting = [not_full |-> {"p2"}, not_empty |-> {}]      record 10: p1 put (notifies not_empty)
State 12: matched = 10  waiting = [not_full |-> {}, not_empty |-> {}]          <TraceNext line 53 ...>: SpuriousWakeup of p2
State 13: matched = 11  waiting = [not_full |-> {"p2"}, not_empty |-> {}]      record 11: p2 re-tests, waits again
```

Between records 8 and 11 there was one `not_full` notification but two producers came back
from `wait()`. This is the futex race described above, observed through the log. A spec
without `SpuriousWakeup` would be refuted by the real program; this is the strongest
argument that modelling them is faithfulness, not paranoia.

How often? In each of two batches of 200 fresh logs of `src/fixed.rs` (2 producers x 3
items, 2 consumers, capacity 1), all 200 were accepted with spurious wakeups allowed and
**2 of 200 (1%) were rejected without them**.

### Fresh traces (`make trace`)

`make trace` records four new runs into `target/traces/` (ignored by git), copies the specs
next to them (TLC resolves `EXTENDS` in the checked module's directory), checks each with
`tools/tla.sh check` (expected: accepted, spurious wakeups allowed), and then reports
whether each could also be explained without spurious wakeups. The buggy capture repeats
trials (up to 1000) until one hangs, and fails if none does. The tail of one observed run
(each earlier capture prints the same path line and three provenance lines):

```
target/release/trace --variant buggy --producers 2 --consumers 1 --capacity 1 --items 3 \
  --until-hang --trials 1000 --out target/traces --name TraceRunBuggyHang
target/traces/TraceRunBuggyHang.tla
  A real run of src/buggy.rs: 2 producer(s) x 3 item(s), 1 consumer(s), capacity 1.
  Trial 1 of `trace --until-hang`: HUNG, blocked for good: p1, p2, c1. 8 records, 5 of them waits.
  Takes that test FIFO order (items of 2+ producers queued): 0.
../tools/tla.sh check target/traces
  ok    rust-blocking-queue/target/traces/TraceRunBuggyHang.cfg            expected accepted NoBehaviourMatchesLog, got accepted; 23 distinct states, 9-state trace, 1s
  ok    rust-blocking-queue/target/traces/TraceRunFixed.cfg                expected accepted NoBehaviourMatchesLog, got accepted; 36 distinct states, 22-state trace, 1s
  ok    rust-blocking-queue/target/traces/TraceRunFixedP3C3K2.cfg          expected accepted NoBehaviourMatchesLog, got accepted; 118 distinct states, 45-state trace, 1s
  ok    rust-blocking-queue/target/traces/TraceRunNotifyAll.cfg            expected accepted NoBehaviourMatchesLog, got accepted; 37 distinct states, 26-state trace, 1s
Same logs with Spurious = FALSE (informational):
  TraceRunBuggyHang: accepted, every wakeup is explained by a notify
  TraceRunFixed: accepted, every wakeup is explained by a notify
  TraceRunFixedP3C3K2: accepted, every wakeup is explained by a notify
  TraceRunNotifyAll: accepted, every wakeup is explained by a notify
```

The informational part is not asserted: a fresh run occasionally needs a spurious wakeup,
and that is a finding, not a failure. Only the capacity-2 capture can test FIFO order, and
only when its log says so (in two batches of 20 recordings of that configuration, 10 and 14
did).

## Demo: how often the real program hangs

`make demo` runs three configurations, 200-1000 fresh trials each per design, no tracer
installed. The summary lines of one observed run:

```
target/release/demo --trials 200 --producers 2 --consumers 1 --capacity 1 --items 100 --stall-ms 50
buggy       hung   200 / 200 (100.0%)   first hang: trial 1        10.2 s
fixed       hung     0 / 200 (  0.0%)   first hang: -               1.1 s
notify_all  hung     0 / 200 (  0.0%)   first hang: -               1.0 s
re-checked all 200 hung trials 1 s later: 200 still stuck, 0 false alarm(s)

target/release/demo --trials 1000 --producers 4 --consumers 3 --capacity 3 --items 200 --stall-ms 50
buggy       hung     0 / 1000 (  0.0%)   first hang: -              10.3 s
fixed       hung     0 / 1000 (  0.0%)   first hang: -               8.5 s
notify_all  hung     0 / 1000 (  0.0%)   first hang: -              10.0 s
re-checked all 0 hung trials 1 s later: 0 still stuck, 0 false alarm(s)

target/release/demo --trials 200 --producers 1 --consumers 1 --capacity 1 --items 1000 --stall-ms 50
buggy       hung     0 / 200 (  0.0%)   first hang: -               4.2 s
fixed       hung     0 / 200 (  0.0%)   first hang: -               4.0 s
notify_all  hung     0 / 200 (  0.0%)   first hang: -               4.1 s
re-checked all 0 hung trials 1 s later: 0 still stuck, 0 false alarm(s)
```

* 3 threads at capacity 1: the buggy queue hangs almost every time, and the re-check a
  second later confirms each hang (a real deadlock never moves again). The fixed and
  notify_all queues never hung.
* 7 threads at capacity 3, where TLC finds a 46-step deadlock in about a second: the buggy
  queue hung in 0 of 1000 trials in this run, and in 0 to 5 of 1000 across runs on this
  machine. A green stress run here says little.
* 1 producer, 1 consumer: nobody hangs, as TLC proves for the buggy design too.

A trial counts as hung when not every put/take has completed, none has completed for the
stall window (50 ms here), and some thread is still inside the queue. Hung threads cannot be
cancelled, so they stay blocked (on 128 KiB stacks) until the process exits. The exit status
is non-zero if a design TLC verified ever hangs for real.

## What the fixed model proves, and its limits

For the configurations above, TLC exhaustively checked that the fixed design (and the
notify_all design) never overflows, never deadlocks, and never leaves a queued item or a
free slot without its own awake consumer or producer while one sleeps (fixed: up to 5
producers, 5 consumers, capacity 3, spurious wakeups included); that it keeps making
progress under F2 with spurious wakeups (fixed: up to 4 producers, 4 consumers, capacity
3), and under F1 for an idealised Condvar or once spurious wakeups stop (2 producers and 1
or 2 consumers, capacity 1); and that every balanced finite workload it was given finishes
(up to 3 producers x 2 items and 3 consumers x 2 takes, capacity 2). It also showed what
the fixed design does *not* give you: starvation freedom for individual threads, under any
fairness a lock can provide, and progress under the literal std guarantees when spurious
wakeups never stop.

Limits:

* **Bounded.** Nothing is proved for other sizes; the small-scope hypothesis is the argument
  that the bugs of this design show up in small configurations (they do: 3 threads).
* **A model of the code, not the code.** The link is (a) the mapping table and per-action
  comments, reviewed by hand, and (b) trace validation, which checks individual real runs
  against the spec. A run that trace validation accepts shows that run conforms; it cannot
  show all runs do. Accepted logs are short (8 to about 50 records) and the recorder runs
  under the lock, which changes timing (a probe effect).
* **What traces can and cannot see.** With spurious wakeups allowed, *any* wakeup can be
  explained, so trace validation checks the buffer contents, the roles, the loop
  conditions, the ordering of critical sections and the final blocked set, and FIFO order
  at the takes where items of two or more producers were queued (never at capacity 1), but
  not who notified whom. The notify discipline is checked only by the `Spurious = FALSE`
  runs, which real runs occasionally (and legitimately) fail.
* **Fairness is assumed, not verified.** F2 is plausible for an OS scheduler with an
  unfair futex Mutex but is not promised by std; F3 is provided by no lock at all.
* **Trusted base:** std's Mutex/Condvar implementation, the OS, and TLC.
