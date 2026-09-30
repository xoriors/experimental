------------------------- MODULE BlockingQueueCommon -------------------------
(***************************************************************************)
(* Definitions shared by the three designs of the bounded blocking queue   *)
(* in ../src/.  Each design module EXTENDS this one:                       *)
(*                                                                         *)
(*   BlockingQueue.tla           src/buggy.rs       1 Condvar, notify_one  *)
(*   BlockingQueueFixed.tla      src/fixed.rs       2 Condvars, notify_one *)
(*   BlockingQueueNotifyAll.tla  src/notify_all.rs  1 Condvar, notify_all  *)
(*                                                                         *)
(* GRANULARITY.  One step = one critical section: everything a thread does *)
(* between getting the queue's Mutex (lock(), or Condvar::wait returning)  *)
(* and giving it up (the guard is dropped, or Condvar::wait is called).    *)
(* The Mutex serialises critical sections.  The only shared state touched  *)
(* outside them is the Condvar's own futex word, inside wait() between     *)
(* unlocking and going to sleep; a notify that lands in that window makes  *)
(* the waiter return without having been picked, i.e. an extra wakeup.    *)
(* So atomic critical sections PLUS SpuriousWakeup (Spurious = TRUE)       *)
(* over-approximate the code; Spurious = FALSE is an idealised Condvar.    *)
(* The Mutex has no variable of its own; it shows up only in the fairness  *)
(* assumptions of the design modules.                                      *)
(***************************************************************************)
EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS
    Producers,  \* threads that loop forever calling q.put(item)
    Consumers,  \* threads that loop forever calling q.take()
    Capacity,   \* the `capacity` passed to new(): the queue holds at most this many items
    Spurious    \* TRUE: Condvar::wait may return without a notification (std allows it)

ASSUME /\ Producers # {} /\ Consumers # {}
       /\ Producers \cap Consumers = {}
       /\ Capacity \in Nat \ {0}
       /\ Spurious \in BOOLEAN

Threads == Producers \cup Consumers

VARIABLES
    buffer,   \* the VecDeque<T> inside the Mutex.  Data is abstracted: an item is
              \* the id of the producer that put it (enough to check FIFO order in traces)
    waiting   \* waiting[cv]: the threads blocked in cv.wait(guard), for each Condvar cv

vars == <<buffer, waiting>>

Waiting     == UNION {waiting[cv] : cv \in DOMAIN waiting}
Runnable(t) == t \notin Waiting    \* running, or contending for the Mutex
Full        == Len(buffer) = Capacity
Empty       == buffer = <<>>

(***************************************************************************)
(* std::sync::Condvar, as documented for Rust 1.94.                        *)
(***************************************************************************)

(* wait(guard): "atomically unlock the mutex specified (represented by     *)
(* guard) and block the current thread".                                   *)
Wait(t, cv) == waiting' = [waiting EXCEPT ![cv] = @ \cup {t}]

(* notify_one(): "If there is a blocked thread on this condition           *)
(* variable, then it will be woken up ... Calls to notify_one are not      *)
(* buffered in any way."  WHICH blocked thread is unspecified, so TLC      *)
(* tries every one.  With no blocked thread the call does nothing: the     *)
(* notification is lost, not saved for the next wait() (a Condvar is not   *)
(* a semaphore).                                                           *)
NotifyOne(cv) ==
    IF waiting[cv] = {}
    THEN UNCHANGED waiting
    ELSE \E t \in waiting[cv] : waiting' = [waiting EXCEPT ![cv] = @ \ {t}]

(* notify_all(): "Wakes up all blocked threads on this condvar."           *)
NotifyAll(cv) == waiting' = [waiting EXCEPT ![cv] = {}]

(* "Note that this function is susceptible to spurious wakeups": wait()    *)
(* may return although nobody notified.  This happens for real in std's    *)
(* futex Condvar: a notify that lands between a waiter's unlock and its    *)
(* futex_wait makes that waiter return too, on top of the thread that      *)
(* futex_wake woke.  No code of ours runs in this step: the woken thread   *)
(* only becomes runnable, and its next critical section re-checks the      *)
(* `while` condition.                                                      *)
SpuriousWakeup ==
    /\ Spurious
    /\ \E cv \in DOMAIN waiting : \E t \in waiting[cv] :
           waiting' = [waiting EXCEPT ![cv] = @ \ {t}]
    /\ UNCHANGED buffer

(***************************************************************************)
(* Safety properties, the same for every design.                           *)
(***************************************************************************)

TypeOK ==
    /\ buffer \in Seq(Producers)
    /\ DOMAIN waiting # {}
    /\ \A cv \in DOMAIN waiting : waiting[cv] \subseteq Threads

\* The queue never holds more than `capacity` items.
BoundedBuffer == Len(buffer) <= Capacity

\* Deadlock freedom as a state predicate: some thread is not blocked in wait().
\* A runnable thread always has a step (its `while` condition is either true or
\* false), so with Spurious = FALSE this is exactly TLC's built-in deadlock check.
\* With Spurious = TRUE a SpuriousWakeup step is enabled whenever anybody waits,
\* TLC's check can no longer see "everyone waits", and only this invariant can.
NoDeadlock == ~(Threads \subseteq Waiting)

\* No lost wakeup: while any consumer is blocked, every queued item has its own
\* awake consumer (queued items <= runnable consumers); while any producer is
\* blocked, every free slot has its own awake producer.  Counting matters: "some
\* consumer is awake" is too weak, because in a spec whose threads never quit one
\* awake consumer drains everything, so a design that strands a second sleeper
\* next to a second item would pass (Mutant_NotifyOnlyOnTransition).  A broken
\* design violates these well before it deadlocks.
AwakeConsumers == Cardinality({c \in Consumers : Runnable(c)})
AwakeProducers == Cardinality({p \in Producers : Runnable(p)})
ConsumerAwake == Consumers \cap Waiting # {} => Len(buffer) <= AwakeConsumers
ProducerAwake == Producers \cap Waiting # {} => Capacity - Len(buffer) <= AwakeProducers

(***************************************************************************)
(* Reachability witnesses (vacuity guards).  Each of these "invariants" is *)
(* EXPECTED TO BE VIOLATED by a Witness*.cfg model: TLC's counterexample   *)
(* proves that the state exists, so the properties above are not true      *)
(* merely because the interesting states are unreachable.                  *)
(***************************************************************************)

\* ConsumerAwake is tested with items queued, not only on an empty queue: a
\* consumer can be blocked although the queue has items (it went to sleep when
\* the queue was empty, and the item's notify is on its way to it).
NoConsumerBlockedWithItems == ~(~Empty /\ Consumers \cap Waiting # {})
\* The mirror image, for ProducerAwake.
NoProducerBlockedWithRoom  == ~(~Full /\ Producers \cap Waiting # {})
\* Every producer blocked at once (the queue full and all of them asleep).
NotAllProducersBlocked     == ~(Producers \subseteq Waiting)
=============================================================================
