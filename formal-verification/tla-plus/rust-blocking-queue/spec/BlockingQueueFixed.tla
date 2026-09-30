------------------------- MODULE BlockingQueueFixed -------------------------
(***************************************************************************)
(* FIXED design, src/fixed.rs: TWO Condvars.  Producers wait on not_full   *)
(* and consumers on not_empty; each side notify_one()s the Condvar the     *)
(* OTHER side waits on, so a wakeup always reaches a thread that needs it. *)
(*                                                                         *)
(* diff BlockingQueue.tla BlockingQueueFixed.tla   mirrors                 *)
(* diff src/buggy.rs src/fixed.rs: only the Condvar names change.          *)
(***************************************************************************)
EXTENDS BlockingQueueCommon

\* struct Fixed { not_full: Condvar, not_empty: Condvar, .. }
CondVars == {"not_full", "not_empty"}

\* Fixed::with_tracer(capacity, ..): an empty queue, nobody waiting.
Init == /\ buffer = <<>>
        /\ waiting = [cv \in CondVars |-> {}]

\* fn put, `while queue.len() == self.capacity` is false:
\*     queue.push_back(item);  self.not_empty.notify_one();
Put(p) == /\ Runnable(p)
          /\ ~Full
          /\ buffer' = Append(buffer, p)
          /\ NotifyOne("not_empty")

\* fn put, the loop condition is true:  queue = self.not_full.wait(queue)
PutWait(p) == /\ Runnable(p)
              /\ Full
              /\ Wait(p, "not_full")
              /\ UNCHANGED buffer

\* fn take, `while queue.is_empty()` is false:
\*     queue.pop_front();  self.not_full.notify_one();
Take(c) == /\ Runnable(c)
           /\ ~Empty
           /\ buffer' = Tail(buffer)
           /\ NotifyOne("not_full")

\* fn take, the loop condition is true:  queue = self.not_empty.wait(queue)
TakeWait(c) == /\ Runnable(c)
               /\ Empty
               /\ Wait(c, "not_empty")
               /\ UNCHANGED buffer

-----------------------------------------------------------------------------
(* Everything below is identical in the three design modules. *)

\* One critical section of a producer / consumer.  A runnable thread always has
\* one: its `while` condition is either true or false.  A thread that returns
\* from wait() takes the same step as a fresh call, because the `while` loop
\* re-tests the condition under the re-acquired lock.
Producer(p) == Put(p) \/ PutWait(p)
Consumer(c) == Take(c) \/ TakeWait(c)
CS == (\E p \in Producers : Producer(p)) \/ (\E c \in Consumers : Consumer(c))

Next == CS \/ SpuriousWakeup

Spec == Init /\ [][Next]_vars

(* Fairness assumptions, weakest first.  Spurious wakeups get none:        *)
(* they may happen, never must.                                            *)

\* (F1) What std promises.  The Mutex is unfair (a thread returning from
\* wait() can lose the lock to a thread that just arrived), but never idle:
\* if some thread wants it, some thread gets it.
LockFair == WF_vars(CS)

\* (F2) Every runnable thread eventually runs its next critical section: the
\* OS schedules it and it is not bypassed on the Mutex forever.  It says
\* nothing about the queue being in the right state when it gets there.
ThreadFair == /\ \A p \in Producers : WF_vars(Producer(p))
              /\ \A c \in Consumers : WF_vars(Consumer(c))

\* The most any lock can promise: a thread that keeps wanting the Mutex
\* eventually gets it (strong fairness on its critical section).  Here that
\* is no more than F2: Producer(p) stays enabled until p moves, so SF and WF
\* on it coincide, and it does not prevent starvation (NotifyAll_LockStrongFair).
ThreadStrongFair == /\ \A p \in Producers : SF_vars(Producer(p))
                    /\ \A c \in Consumers : SF_vars(Consumer(c))

\* (F3) Hypothetical, and NOT a property of any lock: a thread that is again
\* and again able to complete its put/take eventually does.  It depends on
\* the queue's state at the moment the thread runs, so only a scheduler that
\* looks inside the queue could provide it.  Used only to show what
\* starvation freedom would need.
StrongFair == /\ \A p \in Producers : SF_vars(Put(p))
              /\ \A c \in Consumers : SF_vars(Take(c))

SpecLockFair         == Spec /\ LockFair
SpecThreadFair       == Spec /\ ThreadFair
SpecThreadStrongFair == Spec /\ ThreadStrongFair
SpecStrongFair       == Spec /\ ThreadFair /\ StrongFair

(* Liveness *)

\* System-wide progress: items keep going in and keep coming out.
Progress == /\ []<><<\E p \in Producers : Put(p)>>_vars
            /\ []<><<\E c \in Consumers : Take(c)>>_vars

\* Progress, provided spurious wakeups eventually stop.
ProgressIfSpuriousStops == (<>[][~SpuriousWakeup]_vars) => Progress

\* Starvation freedom: EVERY producer keeps putting, EVERY consumer keeps taking.
NoStarvation == /\ \A p \in Producers : []<><<Put(p)>>_vars
                /\ \A c \in Consumers : []<><<Take(c)>>_vars
=============================================================================
