------------------------- MODULE TraceBlockingQueue -------------------------
(***************************************************************************)
(* TRACE VALIDATION: is a log recorded from the real Rust queue a          *)
(* behaviour of the design?  (H. Cirstea, M. A. Kuppe, B. Loillier,        *)
(* S. Merz: "Validating Traces of Distributed Programs Against TLA+        *)
(* Specifications", 2024.)                                                 *)
(*                                                                         *)
(* The queues call their Tracer once per critical section, WHILE HOLDING   *)
(* THE QUEUE'S MUTEX, so the log's order is the order in which critical    *)
(* sections really ran (src/trace.rs).  src/bin/trace.rs writes a log out  *)
(* as a module that EXTENDS this one (e.g. TraceFixedOk.tla).  TLC then    *)
(* looks for a behaviour of the design whose steps match the log, one      *)
(* record per step, and fills in what the log cannot show: which waiter    *)
(* each notify_one woke, and where spurious wakeups happened.              *)
(*                                                                         *)
(* ACCEPTANCE.  TLC 2.19 has no POSTCONDITION (its config parser rejects   *)
(* the keyword), so acceptance is an invariant that claims the opposite:   *)
(*   NoBehaviourMatchesLog is violated => the log is ACCEPTED, and TLC's   *)
(*       "counterexample" is the matching behaviour (the witness);         *)
(*   NoBehaviourMatchesLog holds       => the log is REJECTED.             *)
(* Deadlock checking must be off: a wrong guess (say, notify_one woke the  *)
(* thread the log never hears from again) is a dead end, not an error.     *)
(***************************************************************************)
EXTENDS BlockingQueueDesigns   \* the design to check against: constant Variant

CONSTANTS
    Log,      \* <<[t |-> thread, op |-> "put" | "take" | "wait", item |-> producer or ""], ...>>
    Blocked   \* threads blocked in wait() when the log ended: {} if every thread returned

VARIABLE matched   \* the first `matched` records of Log have been matched

\* One log record = one critical section = one step of the design, by a thread
\* of the right role (the design only lets producers put and consumers take).
\*   Event::Put(&item)  -> Put:  and the item is the producer's own (bin/trace.rs puts its name)
\*   Event::Take(&item) -> Take: and the item is the head of the buffer (FIFO)
\*   Event::Wait        -> PutWait for a producer, TakeWait for a consumer
\* A record naming a thread of neither role, or an unknown op, matches nothing.
Match(r) ==
    CASE r.op = "put"  -> r.t \in Producers /\ DPut(r.t) /\ r.item = r.t
      [] r.op = "take" -> r.t \in Consumers /\ DTake(r.t) /\ Head(buffer) = r.item
      [] r.op = "wait" -> \/ r.t \in Producers /\ DPutWait(r.t)
                          \/ r.t \in Consumers /\ DTakeWait(r.t)
      [] OTHER         -> FALSE

TraceInit == DInit /\ matched = 0

TraceNext ==
    \/ /\ matched < Len(Log)
       /\ Match(Log[matched + 1])
       /\ matched' = matched + 1
    \* A spurious wakeup happens inside Condvar::wait, where no code of ours
    \* runs, so it is never logged; it may occur between any two records.
    \/ /\ SpuriousWakeup
       /\ UNCHANGED matched

\* The whole log is matched, and the design has exactly the threads blocked that
\* were blocked in the real run when the log ended.
Accepted == matched = Len(Log) /\ Waiting = Blocked

NoBehaviourMatchesLog == ~Accepted

\* WHERE a log is rejected.  A model sets `CONSTANT MatchLimit = n` (TLC lets a
\* model override a definition by a value) and checks this invariant:
\* violated <=> records 1..n can all be matched; holds <=> record n never is.
MatchLimit == 0
MatchedFewerThanLimit == matched < MatchLimit
=============================================================================
