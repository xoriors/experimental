# go-worker-pool: Submit racing Shutdown, caught by TLA+

A Go worker pool with a graceful shutdown (`New(workers, queueSize, handler)`,
`Submit(job) error`, `Shutdown()`) in three versions, side by side. Each
version has a spec written in PlusCal (an algorithm language that compiles to
TLA+) that TLC, the TLA+ model checker, checks exhaustively, and a test that
replays TLC's counterexample against the real Go code, step by step.
[`../README.md`](../README.md) has the background: what TLC does, the
`EXPECT` headers every model carries, and the sibling Rust project.

| package     | design | TLC | counterexample replayed on the real code |
|-------------|--------|-----|------------------------------------------|
| `buggy/`    | Submit checks `closed` under the mutex, unlocks, **then** sends | `NoPanic` violated in 4 steps (a 5-state trace) | `panic: send on closed channel` |
| `quitchan/` | never close `jobs`; Submit and workers `select` on a `quit` channel | `ShutdownDrains` violated in 6 steps (a 7-state trace) | `Submit` returns nil and the job is never handled |
| `fixed/`    | `buggy/` plus 4 lines: count in-flight senders under the mutex, wait for them before `close` | every property holds, in a small and a large model, including termination | same schedule: `Shutdown` blocks until the send is done; no panic, and the job is handled before `Shutdown` returns |

## Quick start

```sh
make all        # go vet, gofmt, go test -race; then every PlusCal translation and TLC model
make replay     # only the counterexample replays, verbosely (section 9)
make demo       # stress the real pools without hooks, then under -race (section 2)
../tools/tla.sh tlc spec/WorkerPoolBuggy.tla spec/WorkerPoolBuggy.cfg   # one model, full TLC output
```

Requirements: Go 1.24+ (standard library only), Java 11+ for TLC, `bash`,
`make` and `curl`. The first `make verify` (part of `make all`) downloads the
pinned, sha256-checked `tla2tools.jar` (v1.7.4, TLC 2.19) into
`../.tools/`. `make demo` takes `DEMO_RUNS` (default 20000), `RACE_RUNS`
(500) and `RACE_PROCS` (300), e.g. `make demo DEMO_RUNS=2000`. `make pcal`
re-translates the PlusCal after you edit a spec; `make verify` fails if you
forget. `make verify` and `make test` also run from `..` for both projects.

Nothing is generated inside the source tree: `../tools/tla.sh` gives every
TLC run a private state directory and `java.io.tmpdir` (so concurrent runs do
not collide), `check` writes each model's TLC log to `../.tools/logs/`, and
`go run` builds out-of-tree.

**Terms used below.** A *model* is a `.cfg` file: constants (how many
clients, workers, ...) plus the properties to check. An *invariant* (safety
property) must hold in every reachable state; a *liveness* property says
something eventually happens. A *trace* or *counterexample* is a sequence of
states, so a 5-state trace has 4 steps. A *lasso* is an infinite behaviour
that ends in a loop; here the loop is usually *stuttering*, a state in which
nothing ever moves again. *Weak fairness* for a process: if it can take a
step and keeps being able to, it eventually does. One spec *refines* another
if every behaviour of the first, seen through a mapping of its variables, is
a behaviour of the second.

---

## 1. The bug

```go
func (p *Pool[J]) Submit(job J) error {          // buggy/pool.go, test hooks left out
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return ErrClosed
	}
	p.mu.Unlock()
	// BUG: from here on nothing stops Shutdown from closing p.jobs.
	p.jobs <- job                                // panic: send on closed channel
	return nil
}

func (p *Pool[J]) Shutdown() {
	p.mu.Lock()
	first := !p.closed
	p.closed = true
	p.mu.Unlock()
	if first {                                   // closing twice would panic too
		close(p.jobs)
	}
	p.workers.Wait()
}
```

Every access to `closed` happens under the mutex, so the code *looks*
synchronised. But the check (`if p.closed`) and the use (`p.jobs <- job`) are in
different critical sections, a time-of-check/time-of-use (TOCTOU) race. If
`Shutdown` runs between them, the send panics, and an unrecovered panic kills
the whole process. The window is wider than it looks: a Submit that passed the
check and is **blocked on a full queue** is inside it too. The Go spec says a
send "proceeds by causing a run-time panic" once the channel is closed, even
if it was blocked when the channel was closed.

## 2. What tests, stress runs and the race detector see (measured)

**The ordinary functional suite passes on `buggy/`.** The shared scenarios
(`internal/scenario`) cover sequential submits, concurrent submitters followed
by `Shutdown`, `Submit` after `Shutdown`, 8 concurrent plus 2 repeated
`Shutdown` calls, and `Shutdown` waiting for a running handler. They pass on
`buggy/` every time, also under `go test -race`: none of them overlaps a
`Submit` with a `Shutdown`, and a typical graceful-shutdown test suite does not
either. On `quitchan/` one of them, `Submit` after `Shutdown`, catches that
pool's bug essentially every time (section 4).

**A racing test written for this bug catches both buggy pools.**
`TestSubmitRacesShutdown` is the fixed pool's racing test: 300 rounds of 4
submitters × 16 jobs against a `Shutdown` call, on 2 workers and a queue of 1,
checking every property of the spec in every round. Run against the buggy
pools (`RACING=1 go test -count=1 -run SubmitRacesShutdown ./buggy/ ./quitchan/`;
`go test` skips it there), it failed 100 of 100 runs for each, most of them
within the first dozen rounds and none later than round 38 (`buggy`: "send
on closed channel") or round 80 (`quitchan`: an accepted job not handled
when `Shutdown` returned), and 20 of 20 runs for each under `-race`.

**How often a single run hits it depends on the load.** `make demo` races
submitters against `Shutdown` with no hooks, 20,000 runs per variant and load
profile. "idle": 4 workers, a queue of 1024, an instant handler, 4 submitters
× 64 jobs. "backpressure": 2 workers, a queue of 1, a 2 µs handler, the same
submitters. `Shutdown` is called once a quarter of all jobs have been
accepted. One run on this machine (4 cores, shared with other jobs):

```
variant   load             runs    runs w/ panic     runs w/ lost    lost jobs   accepted
buggy     idle            20000       321 ( 1.60%)         0 ( 0.00%)            0    1388236
buggy     backpressure    20000     13303 (66.52%)         0 ( 0.00%)            0    1449887
quitchan  idle            20000         0 ( 0.00%)       670 ( 3.35%)         1666    1474177
quitchan  backpressure    20000         0 ( 0.00%)      8168 (40.84%)         8168    1455718
fixed     idle            20000         0 ( 0.00%)         0 ( 0.00%)            0    1402001
fixed     backpressure    20000         0 ( 0.00%)         0 ( 0.00%)            0    1472239
```

The rates vary a lot between runs: over six runs they ranged from 0.64 to
1.60 % (idle) and 19 to 69 % (backpressure) for `buggy`, and from 0.82 to
3.35 % and 14 to 41 % for `quitchan`. The test's shape matters even more:
with `cmd/stress` changed to call `Shutdown` as soon as the submitters are
released, 200 idle runs gave 0 or 1 panics, because in most runs `Shutdown`
won outright and every `Submit` was rejected. So a test finds these bugs once
someone has guessed the right shape for it (a small queue, many rounds,
`Shutdown` in the middle of the traffic), and a test with the wrong shape
passes.

**The race detector does flag the buggy pool, with caveats.** A common claim
is that there is no data race here, so `go test -race` cannot flag it. That is
**not** what we observed. `runtime/chan.go` (Go 1.24.7) deliberately tells the
race detector that `close` writes the channel and a send reads it:

```go
// runtime/chan.go, Go 1.24.7
func chansend(c *hchan, ep unsafe.Pointer, block bool, callerpc uintptr) bool {
	...
	if raceenabled {
		racereadpc(c.raceaddr(), callerpc, abi.FuncPCABIInternal(chansend))
	}
...
func closechan(c *hchan) {
	...
	if raceenabled {
		callerpc := sys.GetCallerPC()
		racewritepc(c.raceaddr(), callerpc, abi.FuncPCABIInternal(closechan))
		racerelease(c.raceaddr())
	}
```

So a send and a close that are not ordered by happens-before count as a race.
In the buggy pool the send after `Unlock` is never ordered with `Shutdown`'s
close. `scripts/race-demo.sh` (the second half of `make demo`) observed
(module paths shortened, one stack line dropped):

```
== 1. stress under -race, 500 runs per load profile
   buggy     idle              500       132 (26.40%)         0 ( 0.00%)            0      60520
   buggy     backpressure      500       348 (69.60%)         0 ( 0.00%)            0      34954
   -> buggy: 1 DATA RACE report(s)
      | Write at 0x00c000112010 by goroutine 16:
      |   runtime.closechan()
      |   github.com/xoriors/.../go-worker-pool/buggy.(*Pool[go.shape.int]).Shutdown()
      | Previous read at 0x00c000112010 by goroutine 12:
      |   runtime.chansend()
   quitchan  idle              500         0 ( 0.00%)        15 ( 3.00%)           27      97873
   quitchan  backpressure      500         0 ( 0.00%)       167 (33.40%)          167      35385
   -> quitchan: 0 DATA RACE report(s)
   fixed     idle              500         0 ( 0.00%)         0 ( 0.00%)            0      54284
   fixed     backpressure      500         0 ( 0.00%)         0 ( 0.00%)            0      35565
   -> fixed: 0 DATA RACE report(s)
== 2. buggy pool, idle profile, one run per process, 300 processes
   race reported + panicked: 127
   race reported, no panic:  150
   panicked, no report:      0
   neither:                  23
```

The detector reports a given pair of racing statements once per process,
hence "1 report" in part 1 and one process per run in part 2. What this shows:

* With `-race`, a test that really overlaps `Submit` and `Shutdown` usually
  gets a DATA RACE report **without needing the panic to happen**: 150 of 300
  processes got a report and never panicked. The panic itself was also far
  more frequent under `-race` (24 to 32 % of idle runs, against 0.6 to 1.6 %
  without it), presumably because the instrumentation widens the window.
* The detector is still a dynamic tool: it sees only the executions a test
  produces, and the functional suite passes under `-race`. It is not
  exhaustive either: over 14 runs of part 2, 19 to 57 of each 300 processes
  neither panicked nor got a report, and 1 of the 4,200 panicked without a
  report. A plausible explanation is the detector's bounded per-address
  history; I did not investigate.
* The replay test (section 9) passes under `-race` too. Its hooks order the
  close before the send (close → hook → test → resume → send), so the
  detector sees no race in that execution.
* The **`quitchan` bug has no data race at all**: 0 reports in 1,000 runs, 182
  of which lost work. The race detector cannot find it by construction.

**What TLC adds.** It finds both bugs from the design alone, in about a
second, without anyone having to guess which test would provoke them. And for
the fixed pool it shows what no number of green runs can: the properties hold
in **every** interleaving of the model.

## 3. The fix

`diff -U2 buggy/pool.go fixed/pool.go`, without the first hunk (the package
doc comment and name):

```diff
@@ -29,4 +29,5 @@
 	closed  bool // guarded by mu
 	jobs    chan J
+	senders sync.WaitGroup // FIX: Submits between the closed check and the send
 	workers sync.WaitGroup
 	handler func(J)
@@ -59,6 +60,9 @@
 		return ErrClosed
 	}
+	// Announce the send while holding mu: Shutdown sets closed under mu
+	// too, so it either saw this Add or made us return ErrClosed above.
+	p.senders.Add(1) // FIX
 	p.mu.Unlock()
-	// BUG: from here on nothing stops Shutdown from closing p.jobs.
+	defer p.senders.Done() // FIX
 
 	testHookSubmitAdmitted()
@@ -79,4 +83,5 @@
 	// Only the first call closes: closing a closed channel panics.
 	if first {
+		p.senders.Wait() // FIX: no admitted Submit is still about to send
 		close(p.jobs)
 		testHookShutdownClosed()
```

Why the fix is correct:

* A `Submit` that saw `closed == false` has done `senders.Add(1)` before it
  releases the mutex. `Shutdown` sets `closed` under the same mutex, so it
  either comes first (and the `Submit` returns `ErrClosed`) or it comes later
  and its `senders.Wait()` counts that `Submit`.
* No `Add` can happen after `closed` is set. That satisfies `WaitGroup`'s rule
  that "calls with a positive delta that occur when the counter is zero must
  happen before a Wait".
* The workers keep draining while `Shutdown` waits, so a sender blocked on a
  full queue eventually gets through. `WorkerPoolFixed_NoWorkers.cfg` shows the
  deadlock you get without workers, which is why `New` rejects `workers < 1`.

**Repeated and concurrent `Shutdown`.** Only the first call (`first == true`)
closes the channel, because a second close would panic. Every call, including
later ones, waits in `p.workers.Wait()`, so every call returns only after the
queue has been drained. All pool models except the `NoWorkers` sanity check
run two `Shutdown` goroutines, and `Probe_ConcurrentShutdown` shows that one
call really does wait for the workers while the other has not yet closed the
channel.

**Alternatives I did not model.** One is holding the mutex across the send:
it serialises all producers, and a `Submit` blocked on a full queue then also
blocks `Shutdown` and every other `Submit` behind the mutex. Another is
recovering the panic in `Submit` and returning `ErrClosed`. That would avoid
the crash, but it uses a runtime panic as control flow, and the race detector
still reports the unordered send/close.

## 4. The second bug: `quitchan` never panics, it loses work

```go
func (p *Pool[J]) Submit(job J) error {          // quitchan/pool.go
	select {
	case <-p.quit:
		return ErrClosed
	case p.jobs <- job: // BUG: if quit is closed too, still chosen half the time
		return nil
	}
}
// worker: select { case job := <-p.jobs: ...; case <-p.quit: drain with select/default, then return }
// Shutdown: p.once.Do(func() { close(p.quit) }); p.workers.Wait()
```

A popular way to avoid "send on closed channel" is to never close `jobs`. A
`select` does not prefer the case written first. The Go spec says: "If one or
more of the communications can proceed, a single one that can proceed is
chosen via a uniform pseudo-random selection". So once `quit` is closed, a
`Submit` that finds room in the queue still enqueues half of the time. If the
workers have already drained the queue and left, that job is never handled,
although `Submit` returned nil. The code has no data race and never panics,
so neither the race detector nor a crash tells you. A plain sequential test
does, once someone writes it: after `Shutdown` has returned, each `Submit`
returns nil with probability 1/2, so the shared `SubmitAfterShutdownFails`
scenario (100 `Submit`s) fails essentially always. `quitchan/` therefore runs
it with the verdict inverted, as `TestSubmitAfterShutdownIsAccepted`.

TLC finds the bug from the design in 6 steps (section 8), in the form
where `Submit` overlaps `Shutdown`. `WorkerPoolQuit_NoPanic.cfg` confirms
that nothing else is wrong with this design: it is panic-free, deadlock-free
and terminates. `WorkerPoolQuit_LostForever.cfg` shows that the job is not
merely late: it is never handled.

## 5. The specs

| file | what |
|------|------|
| `spec/GoChan.tla` | Go channel semantics as operators, shared by all specs |
| `spec/GoChanCheck.tla` | unit test of `GoChan.tla` on its own (FIFO, no loss, panics, wake-up on close, `range` termination) |
| `spec/WorkerPoolBuggy.tla` | model of `buggy/pool.go` |
| `spec/WorkerPoolFixed.tla` | model of `fixed/pool.go`: the buggy spec plus the lines marked `FIX` |
| `spec/WorkerPoolFixedProbes.tla` | vacuity guards for the fixed spec (weakened fairness, mutations, reachability probes) and the `Shutdown`-optional environment |
| `spec/WorkerPoolFixedMutex.tla` | `fixed/pool.go` with an explicit `sync.Mutex`, one step per statement, and a checked refinement to `WorkerPoolFixed` |
| `spec/WorkerPoolQuit.tla` | model of `quitchan/pool.go` |
| `spec/*.cfg` | one TLC model each, with `SPEC`/`EXPECT`/`WHY` headers (section 7) |

`diff spec/WorkerPoolBuggy.tla spec/WorkerPoolFixed.tla` shows, in the
PlusCal, exactly the code fix: the `senders` variable, `senders + 1` in
`c_admit`, the new `c_release` label and the new `sd_wait_senders: await
senders = 0`. It also adds the `senders` line to `TypeOK` (marked `FIX`). The
rest of the diff is the module name and header comment, three label
comments that follow the code (`c_admit`'s gains `p.senders.Add(1)`,
`return nil` moves from `c_send` to `c_release`, `testHookShutdownMarked()`
from `sd_close` to `sd_wait_senders`), and the regenerated translation.

Sections 5.1 and 5.2 argue, rule by rule, that the model is faithful to Go
and to the code; the one argument TLC checks for itself, the atomicity of a
critical section, is at the end of 5.2.

<details>
<summary><b>5.1 Go semantics and 5.2 atomicity: why the model is faithful</b></summary>

### 5.1 Go semantics, modelled from the language spec (`GoChan.tla`)

A channel is a record `[buf, cap, closed]`. Each operation is one atomic
step, because `chansend`, `chanrecv` and `closechan` run under the channel's
lock:

| Go | operator | rule (Go spec) |
|----|----------|----------------|
| `ch <- v` can take its step | `SendReady(ch) == ch.closed \/ Len(ch.buf) < ch.cap` | blocks until "there is room in the buffer"; on a closed channel it "proceeds by causing a run-time panic", even if it was blocked when the close happened |
| ... and panics | `SendPanics(ch) == ch.closed` | "send on closed channel" |
| `v, ok := <-ch`, one `range` iteration | `RecvReady == closed \/ buffer non-empty`, `RecvOK == buffer non-empty` | buffered values are still delivered after close; `ok = false` / `range` ends only once closed **and** drained |
| `close(ch)` | `ClosePanics(ch) == ch.closed` | "closing a closed channel causes a run-time panic" |
| `select` | PlusCal `either`, each branch guarded by its case being ready | one ready case, chosen uniformly at random. TLC explores every ready case, which is exactly the set of outcomes with non-zero probability; `default` becomes if/else on readiness |
| `sync.Mutex` critical section | one step (see 5.2), explicit in `WorkerPoolFixedMutex.tla` | |
| `sync.WaitGroup` | a counter; `Wait` is `await counter = 0` | exact here, because no `Add` happens after a `Wait` has started |
| `sync.Once.Do(close)` | one step `if (~once) { once := TRUE; close }` | exact, because `f` is itself one atomic step and `Do` makes concurrent callers wait for it |

`GoChanCheck.cfg` (3 senders, 1 ranging receiver, 2 closers, capacity 2)
checks these operators against the rules above: no value lost or duplicated,
FIFO order, no send completes after close, `range` ends only when the channel
is closed and drained, a sender blocked at close panics, and exactly one close
succeeds. `GoChanCheck_NoReceiver.cfg` removes the receiver, so nothing ever
frees a slot: the sender blocked on the full buffer can finish only because
`close` wakes it, which pins the `ch.closed \/` half of `SendReady` (a
`GoChan` without it deadlocks there, and passes every other model). Three
probe models show that the interesting cases really happen: a blocked sender
panics, a value is received after close, and a double close panics.

PlusCal macros cannot be imported from another module, so each pool spec has
its own small macros that call these operators (`send_job`, and `close_jobs`
in the specs that close `p.jobs`).

**Abstractions in the channel model.** None of them hides a bug:

* **Language-spec level, not runtime level.** The runtime hands a freed slot
  to the longest-waiting sender (FIFO) and does it atomically with the
  receive. It also hands a value directly to a waiting receiver. The model
  lets any enabled sender take a free slot, with one intermediate state in
  between. That is a **superset** of the runtime's behaviours: each runtime
  step is a model step, or two model steps back to back. So every state the
  runtime can reach, the model can reach, and a safety property proved on the
  model holds for the runtime. Liveness is unaffected because the number of
  sends is finite. The same holds for a `select` that was blocked: the
  runtime completes it with the case that woke it, while the model may pick
  any case that is ready when it steps.
* **Unbuffered channels are not modelled.** A rendezvous send needs a joint
  step, so `New` rejects `queueSize < 1`, and the specs assume
  `QueueSize \in Nat \ {0}`.
  The one unbuffered channel, `quit`, is never sent on; for it
  `RecvReady == closed` is exact.

**Could an abstraction invent a bug?** A superset model could, in principle,
report a behaviour the runtime cannot produce. Neither counterexample depends
on the extra freedom: the TOCTOU trace has no blocked sender at all, and the
quitchan trace needs only a `select` that starts with two ready cases. Both
are replayed on the real runtime (section 9). The coarse atomicity of 5.2
cannot invent anything either: the fine-grained spec can always run a
critical section without interruption, so every coarse behaviour is also a
fine-grained one.

### 5.2 Processes and labels: where goroutines interleave

There is one PlusCal process per goroutine: `client` (calls `Submit` once),
`shutdown` (calls `Shutdown` once; two of them model concurrent and repeated
calls) and `worker` (started by `New`). A label marks one atomic step: other
goroutines can run only between labels. Each label holds one operation on
shared state that is atomic in Go, or one mutex critical section. The
argument is in each spec's header:

* The code has no data races in the Go memory model's sense, and the memory
  model guarantees that such a program behaves as if its goroutines' steps
  were interleaved one at a time (sequential consistency for data-race-free
  programs, "DRF-SC"). So an interleaving model is exact. The race detector's
  send/close report in section 2 is on a pseudo-address that the runtime uses
  to flag unordered send/close pairs. Channel operations themselves
  synchronise, so this is not a data race on program memory.
* Channel operations and `WaitGroup` operations are atomic.
* Local computation is invisible to other goroutines, so it is folded into the
  neighbouring step.
* The handler does not touch the pool, so it is one opaque step.
* A mutex critical section is one step by Lipton's reduction theorem: `Lock`
  can always be moved later and `Unlock` earlier past other goroutines'
  steps without changing the outcome, so every interleaving is equivalent to
  one in which the section runs without interruption.

**This last point is checked by TLC, not just argued.**
`WorkerPoolFixedMutex.tla` models `sync.Mutex` explicitly, with one step per
statement (`c_lock`, `c_check`, `c_add`, `c_unlock`, `sd_lock`, `sd_read`,
`sd_write`, `sd_unlock`, ...). It checks `RefinesWorkerPoolFixed ==
Coarse!Spec`: under a pc mapping, every fine-grained behaviour satisfies the
coarse spec, its steps up to stuttering (fine-grained steps that only move the
mutex map to "nothing happens") and its fairness conditions. So every
property proved of the coarse spec, liveness included, holds for the
fine-grained one. The one step of a critical section that writes shared state
must match the coarse step, and that only works if the value of `closed` read
earlier in the section is still valid. The mutex guarantees that. The
mutation model `WorkerPoolFixedMutex_NoExclusion.cfg` replaces `Lock` with a
lock that never blocks, and TLC then rejects the refinement ("Action property
... is violated") in a 7-state trace: `c1` reads `closed = FALSE`, `s1` sets
it, then `c1` adds to `p.senders`. That is exactly the step the coarse spec
forbids. So the refinement check has teeth.

Hook placement follows the labels. The TOCTOU replay needs three
interleaving points and the quitchan replay needs one. Each has a
`testHookXxx` on the matching label boundary (section 6).

</details>

### 5.3 Properties

| property | kind | meaning |
|----------|------|---------|
| `TypeOK` | invariant | types; `senders` stays between 0 and the number of clients (so `WaitGroup` never goes negative); buffer never over capacity |
| `NoPanic` | invariant | no "send on closed channel", no "close of closed channel" |
| `HandledAtMostOnce` | invariant | no job handled twice |
| `HandledOnlyIfAccepted` | invariant | no phantom jobs |
| `ShutdownDrains` | invariant | once **any** `Shutdown` call has returned, every job whose `Submit` returned nil has been handled exactly once |
| `RejectOnlyAfterShutdown` | invariant | `ErrClosed` only once shutdown has started |
| deadlock freedom | TLC default | no reachable state where some goroutine is unfinished and none can move |
| `Termination` | liveness | every goroutine (clients, `Shutdown` callers, workers) reaches `Done`: every call returns, no goroutine leaks |
| `AcceptedEventuallyHandled` | liveness | `j \in accepted ~> handled[j] = 1` (`~>`: "leads to") |

`accepted`, `rejected`, `handled` and `panics` are history variables. They
are not in the code; they only record what the properties talk about.

`AcceptedEventuallyHandled` needs a second model. Under `Spec`, `Shutdown`
is eventually called (5.4), and then the property already follows from
`Termination` plus `ShutdownDrains`: a pool whose workers do nothing until
`Shutdown` passes every property of `WorkerPoolFixed.cfg` (observed: 598
distinct states, no error). `WorkerPoolFixed_ShutdownOptional.cfg` checks it
with no fairness for the `Shutdown` callers, so it says that a running pool
handles accepted jobs on its own; `WorkerPoolFixed_LazyWorkers.cfg` shows that
this model does reject the lazy workers.

### 5.4 Fairness, explicit and justified

Every process is a `fair process`, which means weak fairness per goroutine.

* **Justification.** Go's scheduler has been preemptive since Go 1.14, so a
  runnable goroutine is not starved forever. A goroutine blocked on a
  channel, mutex or `WaitGroup` is woken when its condition holds; the runtime
  queues are FIFO, and `sync.Mutex` has a starvation mode. That is at least
  weak fairness.
* **It also assumes the calls happen.** The first step of `client` and of
  `shutdown` is always enabled, so their fairness also says that the
  application eventually calls `Submit` and `Shutdown`. That is an assumption
  about the caller, not the scheduler. `Termination` needs it (workers exit
  only after `Shutdown`); `AcceptedEventuallyHandled` is also checked without
  it for `Shutdown` (5.3).
* **Why weak is enough.** The number of jobs is finite, so every blocking
  condition in the fixed pool eventually becomes permanently true. TLC proves
  `Termination` with weak fairness only; no strong fairness is assumed.
* **It is needed.** `WorkerPoolFixed_UnfairWorkers.cfg` drops fairness for
  the workers only, and TLC finds a lasso in which the worker stops at
  `w_exit` and then stutters forever, while both `Shutdown` calls hang in
  `p.workers.Wait()`.
* **What it also assumes.** Handlers return, since each one is one step that
  weak fairness forces to happen.

## 6. Code ↔ spec mapping

`fixed/pool.go` ↔ `spec/WorkerPoolFixed.tla`, and `buggy/pool.go` ↔
`spec/WorkerPoolBuggy.tla`, which has no rows marked **FIX**: its `sd_close`
directly follows `sd_mark`, and its `c_send` includes `return nil`.

| Go | `fixed/` line | `buggy/` line | spec label / variable | test hook |
|---|---|---|---|---|
| `p.mu.Lock(); if p.closed { p.mu.Unlock(); return ErrClosed }` | 57–61 | 56–60 | `c_admit` (reject branch → `rejected`) | |
| `p.senders.Add(1)` **FIX**; `p.mu.Unlock()` | 64–65 | 61 | `c_admit` (`senders + 1` **FIX**) | |
| | 68 | 64 | boundary `c_admit` → `c_send` | `testHookSubmitAdmitted` |
| `p.jobs <- job` | 69 | 65 | `c_send` (`send_job` macro: block / panic / enqueue → `accepted`) | |
| deferred `p.senders.Done()` **FIX**, `return nil` | 66, 70 | 66 (in `c_send`) | `c_release` **FIX** | |
| `p.mu.Lock(); first := !p.closed; p.closed = true; p.mu.Unlock()` | 77–80 | 73–76 | `sd_mark` (`if (closed) goto sd_wait_workers`) | |
| | 81 | 77 | boundary after `sd_mark` | `testHookShutdownMarked` |
| `p.senders.Wait()` **FIX** | 85 | | `sd_wait_senders` **FIX** | |
| `close(p.jobs)` | 86 | 81 | `sd_close` (`close_jobs` macro) | |
| | 87 | 82 | boundary after `sd_close` | `testHookShutdownClosed` |
| `p.workers.Wait()` | 89 | 84 | `sd_wait_workers` | |
| `for job := range p.jobs` (one iteration) | 96 | 91 | `w_recv` | |
| `p.handler(job)` | 97 | 92 | `w_handle` (`handled[job] + 1`) | |
| deferred `p.workers.Done()` | 93 | 88 | `w_exit` | |
| fields `closed`, `senders`, `workers`, `jobs` | 29–32 | 29–31 | `closed`, `senders`, `running`, `jobs` | |

`quitchan/pool.go` ↔ `spec/WorkerPoolQuit.tla`:

| Go (`quitchan/pool.go`) | line | spec label | test hook |
|---|---|---|---|
| `select { case <-p.quit: ...; case p.jobs <- job: ... }` | 50–55 | `c_select` (`either` over both cases) | |
| `p.once.Do(func() { close(p.quit) })` | 60 | `sd_quit` | |
| `p.workers.Wait()` | 61 | `sd_wait_workers` | |
| `select { case job := <-p.jobs: ...; case <-p.quit: ... }` | 67–70 | `w_select` | |
| `p.handler(job)` | 69 / 76 | `w_handle` / `w_drain_handle` | |
| `select { case job := <-p.jobs: ...; default: ... }` | 74–77 | `w_drain` | |
| | 78 | boundary `w_drain` → `w_exit` | `testHookWorkerDrained` |
| `return` + deferred `p.workers.Done()` | 79, 65 | `w_exit` | |

## 7. Models and observed results

`make verify` (`../tools/tla.sh check spec`) runs all 22 models and asserts
each one's `EXPECT` header. Every result below, counterexamples included, is
the same on every run: TLC does a breadth-first search on one worker, and
`tla.sh` pins its fingerprint function (`-fp 0`, or `TLC_FP`), without which
the liveness lassos it prints would change from run to run. Each model takes
1–4 s on this machine, except `WorkerPoolFixed_Large` (17–23 s).

| model | clients / `Shutdown` callers / workers / queue | `EXPECT` | what TLC showed | distinct states |
|---|---|---|---|---|
| `WorkerPoolBuggy` | 2 / 2 / 1 / 1 | `safety NoPanic` | the TOCTOU panic, 5-state trace (4 steps; section 8) | 77 |
| `WorkerPoolBuggy_AllButNoPanic` | 2 / 2 / 1 / 1 | `pass` | every other property holds: the panic is its only failure | 594 |
| `WorkerPoolFixed` | 2 / 2 / 1 / 1 | `pass` | all invariants, `Termination`, `AcceptedEventuallyHandled` | 646 |
| `WorkerPoolFixed_Large` | 4 / 2 / 2 / 2 | `pass` | all invariants, `Termination` | 137,224 |
| `WorkerPoolFixed_ShutdownOptional` | 2 / 2 / 1 / 1 | `pass` | `AcceptedEventuallyHandled` without assuming `Shutdown` is ever called | 646 |
| `WorkerPoolFixedMutex` | 2 / 2 / 1 / 1 | `pass` | explicit mutex: all invariants + `MutualExclusion`, `Termination`, `RefinesWorkerPoolFixed` | 2,554 |
| `WorkerPoolFixedMutex_NoExclusion` | 2 / 2 / 1 / 1 | `action` ¹ | mutation (a mutex that does not exclude): refinement rejected, 7-state trace | 350 |
| `WorkerPoolFixed_UnfairWorkers` | 2 / 2 / 1 / 1 | `liveness` | mutation (no fairness for the worker): `Termination` fails, 13-state lasso | 646 |
| `WorkerPoolFixed_LazyWorkers` | 2 / 2 / 1 / 1 | `liveness` | mutation (workers idle until `Shutdown`), `Shutdown` optional: `AcceptedEventuallyHandled` fails, 6-state lasso | 598 |
| `WorkerPoolFixed_NoWorkers` | 2 / **1** / **0** / 1 | `deadlock` | sanity: deadlock detection fires (full queue, no worker), 6-state trace | 46 |
| `WorkerPoolFixed_ProbeSenderInWindow` | 2 / 2 / 1 / 1 | `safety Probe_…` | reachable, 3-state trace: a `Submit` admitted before `Shutdown` marked the pool closed and still before its send, the state in which the buggy pool closes the channel; here `Shutdown` waits in `p.senders.Wait()` | 8 |
| `WorkerPoolFixed_ProbeBlockedSenderInWindow` | 2 / 2 / 1 / 1 | `safety Probe_…` | reachable, 5-state trace: the same with the sender blocked on a full queue | 59 |
| `WorkerPoolFixed_ProbeRejected` | 2 / 2 / 1 / 1 | `safety Probe_…` | reachable, 3-state trace: a `Submit` gets `ErrClosed` | 13 |
| `WorkerPoolFixed_ProbeConcurrentShutdown` | 2 / 2 / 1 / 1 | `safety Probe_…` | reachable, 3-state trace: one `Shutdown` waits for the workers while the other has not closed `p.jobs` yet | 16 |
| `WorkerPoolQuit` | 2 / 2 / 1 / 1 | `safety ShutdownDrains` | lost work, 7-state trace (6 steps; section 8) | 188 |
| `WorkerPoolQuit_NoPanic` | 2 / 2 / 1 / 1 | `pass` | no panic, no deadlock, `Termination`: only the lost-work properties fail | 335 |
| `WorkerPoolQuit_LostForever` | 2 / 2 / 1 / 1 | `liveness` | `AcceptedEventuallyHandled` fails: the job is never handled, 11-state lasso | 335 |
| `GoChanCheck` | 3 senders / 1 receiver / 2 closers / cap 2 | `pass` | the channel operators obey the Go spec rules | 947 |
| `GoChanCheck_NoReceiver` | 3 senders / **0** receivers / 2 closers / cap 2 | `pass` | close wakes the sender blocked on the full buffer, which panics; every goroutine finishes | 138 |
| `GoChanCheck_Probe{BlockedSenderPanics,RecvAfterClose,DoubleClosePanics}` | as `GoChanCheck` | `safety Probe_…` | each reachable (5-, 4- and 3-state traces): a blocked sender panics on close, a value is received after close, a second close panics | 104 / 42 / 26 |

¹ TLC exits with code 13 both for a violated temporal property and for a
violated action property such as the `[][Next]_vars` part of
`RefinesWorkerPoolFixed`; `../tools/tla.sh` reports `action` when TLC's log
says "Action property ... is violated", and `liveness` otherwise.

Together, the failing models show that TLC does report a panic, missing
fairness, a broken refinement, a lazy worker and a deadlock when they exist,
and the probes show that the passing properties are not passing merely
because the dangerous states never occur.

## 8. TLC output (observed, trimmed)

`../tools/tla.sh tlc spec/WorkerPoolBuggy.tla spec/WorkerPoolBuggy.cfg`.
Trimmed: variables that never change are dropped, a later state shows only
what changed plus what its `<-` note is about, `pc` records are joined onto
one line and cut with `...`, and the `<-` notes are mine.

```
Error: Invariant NoPanic is violated.
Error: The behavior up to this point is:
State 1: <Initial predicate>
/\ pc = ( c1 :> "c_admit" @@ c2 :> "c_admit" @@ s1 :> "sd_mark" @@ s2 :> "sd_mark" @@ w1 :> "w_recv" )
/\ panics = {}
/\ jobs = [closed |-> FALSE, cap |-> 1, buf |-> <<>>]
/\ closed = FALSE

State 2: <c_admit line 161, col 18 to line 168, col 47 of module WorkerPoolBuggy>
/\ pc = ( c1 :> "c_send" @@ ... )           <- c1 saw closed = FALSE, released p.mu
/\ closed = FALSE

State 3: <sd_mark line 184, col 18 to line 191, col 47 of module WorkerPoolBuggy>
/\ pc = ( c1 :> "c_send" @@ ... s1 :> "sd_close" @@ ... )
/\ closed = TRUE                            <- Shutdown slipped into the window

State 4: <sd_close line 193, col 19 to line 202, col 40 of module WorkerPoolBuggy>
/\ pc = ( c1 :> "c_send" @@ ... s1 :> "sd_wait_workers" @@ ... )
/\ jobs = [closed |-> TRUE, cap |-> 1, buf |-> <<>>]

State 5: <c_send line 170, col 17 to line 180, col 74 of module WorkerPoolBuggy>
/\ pc = ( c1 :> "Done" @@ ... )
/\ panics = {<<c1, "send on closed channel">>}   <- the admitted send hits the closed channel

105 states generated, 77 distinct states found, 47 states left on queue.
The depth of the complete state graph search is 5.
```

`../tools/tla.sh tlc spec/WorkerPoolQuit.tla spec/WorkerPoolQuit.cfg`,
trimmed the same way. `handled` stays `(c1 :> 0 @@ c2 :> 0)` in every state:

```
Error: Invariant ShutdownDrains is violated.
Error: The behavior up to this point is:
State 1: <Initial predicate>
/\ running = 1
/\ once = FALSE
/\ accepted = {}
/\ pc = ( c1 :> "c_select" @@ c2 :> "c_select" @@ s1 :> "sd_quit" @@ s2 :> "sd_quit" @@ w1 :> "w_select" )
/\ jobs = [closed |-> FALSE, cap |-> 1, buf |-> <<>>]
/\ quit = [closed |-> FALSE, cap |-> 0, buf |-> <<>>]

State 2: <sd_quit line 173, col 18 to line 186, col 39 of module WorkerPoolQuit>
/\ once = TRUE
/\ pc = ( ... s1 :> "sd_wait_workers" @@ ... )
/\ quit = [closed |-> TRUE, cap |-> 0, buf |-> <<>>]      <- Shutdown closes quit, waits for workers

State 3: <w_select line 196, col 19 to line 205, col 52 of module WorkerPoolQuit>
/\ pc = ( ... w1 :> "w_drain" )                           <- queue empty: <-quit is the only ready case

State 4: <w_drain line 213, col 18 to line 221, col 51 of module WorkerPoolQuit>
/\ pc = ( ... w1 :> "w_exit" )                            <- drain finds nothing: default, about to return

State 5: <c_select line 154, col 19 to line 169, col 70 of module WorkerPoolQuit>
/\ accepted = {c1}
/\ pc = ( c1 :> "Done" @@ ... )
/\ jobs = [closed |-> FALSE, cap |-> 1, buf |-> <<c1>>]  <- both cases ready; select took the send

State 6: <w_exit line 229, col 17 to line 233, col 46 of module WorkerPoolQuit>
/\ running = 0
/\ pc = ( ... w1 :> "Done" )

State 7: <sd_wait_workers line 188, col 26 to line 192, col 74 of module WorkerPoolQuit>
/\ accepted = {c1}
/\ pc = ( c1 :> "Done" @@ c2 :> "c_select" @@ s1 :> "Done" @@ s2 :> "sd_quit" @@ w1 :> "Done" )
/\ jobs = [closed |-> FALSE, cap |-> 1, buf |-> <<c1>>]  <- Shutdown returned; c1 accepted, never handled

422 states generated, 188 distinct states found, 52 states left on queue.
```

## 9. The bridge: counterexample replay against the real code

The spec and the code are connected in two ways. The first is the mapping
table above. The second is **replay**: the TLC counterexample is a schedule,
and the test forces that schedule onto the real Go code. Each variant has
unexported hooks at the label boundaries the counterexample uses. They are
no-ops in production, like `net/http`'s `testHookXxx` variables:

```go
var testHookSubmitAdmitted = func() {} // between labels c_admit and c_send
```

In `scenario.ReplayTOCTOU`, `SubmitAdmitted` is a rendezvous: it parks the
client in the window until the test releases it. `ShutdownMarked` and
`ShutdownClosed` only notify the test, which waits for each of them before it
moves on. Pool size and goroutines are those of the TLC model (1 worker,
queue of 1, client `c1`, `Shutdown` caller `s1`):

| TLC state | step | how the test forces it on `buggy/` | the same schedule on `fixed/` |
|---|---|---|---|
| 2 | `c_admit` c1 | start `Submit`; wait until it parks in `testHookSubmitAdmitted` | same |
| 3 | `sd_mark` s1 | start `Shutdown`; wait for `testHookShutdownMarked` | same |
| 4 | `sd_close` s1 | wait for `testHookShutdownClosed` | not enabled in `WorkerPoolFixed.tla` (`s1` is at `sd_wait_senders`, `senders = 1`): wait until `s1` is blocked in `p.senders.Wait()`; fail if `p.jobs` is closed instead |
| 5 | `c_send` c1 | release the parked `Submit`: it panics | release it: the send succeeds, and only then does `s1` close `p.jobs` |

Go has no API that says whether a goroutine is blocked, so for the fixed pool
the test polls `runtime.Stack` until `s1`'s stack shows
`sync.(*WaitGroup).Wait` called from `Shutdown`. While `c1` is parked, that
can only be `p.senders.Wait()`: `p.workers.Wait()` comes after the close. This
matters. Without this check, a fixed pool with `p.senders.Wait()` deleted
still passed the replay under `-race` in 5 to 11 of 3,000 runs (whenever `c1`
happened to send before `s1` reached the close); with it, that mutant fails
3,000 runs in 3,000.

`make replay` observed (`=== RUN` and `[no test files]` lines dropped):

```
go test -race -count=1 -v -run Replay ./...
    pool_test.go:49: events: ["c1 admitted (c_admit)" "s1 marked closed (sd_mark)" "s1 closed p.jobs (sd_close)" "c1 resumes its send (c_send)"]
    pool_test.go:50: Submit panicked with: send on closed channel
--- PASS: TestReplayTOCTOU (0.00s)
PASS
ok  	github.com/xoriors/experimental/formal-verification/tla-plus/go-worker-pool/buggy	1.015s
    pool_test.go:55: events: ["c1 admitted (c_admit)" "s1 marked closed (sd_mark)" "s1 blocked in p.senders.Wait (sd_wait_senders)" "c1 resumes its send (c_send)" "s1 closed p.jobs (sd_close)"]
--- PASS: TestReplayTOCTOU (0.00s)
PASS
ok  	github.com/xoriors/experimental/formal-verification/tla-plus/go-worker-pool/fixed	1.016s
    pool_test.go:113: Submit returned nil after Shutdown had closed p.quit (attempt 1)
--- PASS: TestReplayLostJob (0.00s)
PASS
ok  	github.com/xoriors/experimental/formal-verification/tla-plus/go-worker-pool/quitchan	1.014s
```

What each replay test asserts:

* **buggy:** the recovered panic is a `runtime.Error` whose message is `send on
  closed channel`, the events come in the TLC order, and the job was never
  handled.
* **fixed:** `Shutdown` blocked in `p.senders.Wait()` while `c1` was in the
  window; there is no panic and `Submit` returned nil. The job was handled
  once by the time `Shutdown` returned (`ShutdownDrains`) and once in total
  (`HandledAtMostOnce`). The close came after the send.
* **quitchan** (`TestReplayLostJob`): `testHookWorkerDrained` parks the worker
  between `w_drain` and `w_exit` to reproduce states 2–4. `Submit` then
  returns nil, `Shutdown` returns with the job unhandled, and
  `len(p.jobs) == 1`: the job is stranded, like `jobs.buf = <<c1>>` in state 7.

State 5 of the quitchan trace is a coin flip inside `select` that no hook can
force. Each `ErrClosed` is the other outcome of that same step and leaves the
state unchanged, so the test flips again; 100 misses in a row has probability
2⁻¹⁰⁰ (over 4,000 runs, `Submit` never needed more than 14 attempts).

**Determinism.** The replays ran 300 times per package under `-race`
(`go test -race -count=300 -run Replay ./...`), and the buggy and fixed ones
100 more times per `-cpu` setting of 1, 2 and 4; they passed every time. In
the buggy and fixed replays each step of the table happens in the order
shown. The worker and the later `Shutdown` steps may run earlier than the
trace shows, but they commute with the client's send.

## 10. What is proved, and what is not

**Proved, for every interleaving in the model.** With 2 clients, 2 `Shutdown`
callers, 1 worker and a queue of 1, TLC shows: no panic of either kind; every
accepted job is handled exactly once, before any `Shutdown` call returns;
nothing else is handled; `ErrClosed` only after shutdown started; no
deadlock; under weak fairness, every goroutine finishes; and every accepted
job is eventually handled, also in a pool that is never shut down. With 4
clients, 2 `Shutdown` callers, 2 workers and a queue of 2, it shows the same
invariants and `Termination` (137,224 distinct states). The explicit-mutex version
satisfies the same invariants and refines the coarse spec, fairness included,
so the coarse atomicity hides nothing. The replays show that the model's
counterexamples are real executions of the real code, not artifacts of the
abstraction.

**Limits**

* **The model is bounded.** Larger pools are covered by the small-scope
  hypothesis (the empirical rule that most concurrency bugs show up with a
  few threads; this one needs 1 client and 1 `Shutdown`), not by proof. No
  symmetry reduction (treating interchangeable clients as one) is used: it
  would be unsound combined with the liveness checks.
* **One `Submit` per client.** N sequential `Submit`s from one goroutine are
  a subset of the interleavings of N clients, so this covers them.
* **The handler is one opaque step that returns and never touches the pool.**
  A handler that calls `Shutdown` on its own pool deadlocks: `p.workers.Wait()`
  waits for itself. A handler that calls `Submit` can block while the queue is
  full. Neither is modelled, and `New`'s doc comment forbids the first.
* **The channel model is the language-spec semantics**, a superset of the
  runtime (section 5.1). Unbuffered job queues are not modelled, and `New`
  rejects them.
* **Panics.** A panicking goroutine simply stops. In real code the panic
  would also run `Submit`'s deferred `p.senders.Done()`; the model skips
  that, which cannot matter because `NoPanic` has already failed in that
  state.
* **Liveness assumes** that the Go scheduler eventually runs runnable
  goroutines (weak fairness), that handlers return, and that `Submit` and,
  for `Termination`, `Shutdown` are eventually called (section 5.4).
* **Code and spec are linked by hand** (the mapping table and the hook
  placement), not extracted. A code change can drift from the spec. The
  replay tests catch drift only along the replayed schedules.
* **Only the TLC counterexamples are replayed.** The fixed pool's other
  interleavings are covered by TLC plus the `-race` functional and racing
  tests, not by replay. `TestSubmitRacesShutdown` runs 300 rounds; in four
  observed runs, 261, 268, 284 and 286 of them really overlapped `Submit`
  with `Shutdown`, meaning some `Submit`s were accepted and some rejected in
  the same round.

## Layout

```
buggy/pool.go            TOCTOU pool (+ pool_test.go: functional suite, replay, racing test on request)
fixed/pool.go            the fix     (+ pool_test.go: functional suite, racing test, replay)
quitchan/pool.go         select/quit pool (+ pool_test.go: functional suite, inverted Submit-after-Shutdown, replay, racing test on request)
internal/scenario/       shared scenarios and the replay driver (test-only)
cmd/stress/              no-hook stress run (make demo)
scripts/race-demo.sh     the same under the race detector, summarised
spec/                    GoChan, GoChanCheck, WorkerPool{Buggy,Fixed,FixedProbes,FixedMutex,Quit}.tla + models
```
