----------------------- MODULE BlockingQueueNotifyAll -----------------------
(***************************************************************************)
(* NOTIFY_ALL design, src/notify_all.rs: the buggy design's single Condvar *)
(* `cond`, but every put and take wakes ALL waiters.  Whoever needed the   *)
(* wakeup is among them, so nothing is lost; the price is that every other *)
(* waiter wakes up just to re-test its condition and go back to sleep.     *)
(*                                                                         *)
(* diff BlockingQueue.tla BlockingQueueNotifyAll.tla   mirrors             *)
(* diff src/buggy.rs src/notify_all.rs: notify_one -> notify_all.          *)
(***************************************************************************)
EXTENDS BlockingQueueCommon

\* struct NotifyAll { cond: Condvar, .. }
CondVars == {"cond"}

\* NotifyAll::with_tracer(capacity, ..): an empty queue, nobody waiting.
Init == /\ buffer = <<>>
        /\ waiting = [cv \in CondVars |-> {}]

\* fn put, `while queue.len() == self.capacity` is false:
\*     queue.push_back(item);  self.cond.notify_all();
Put(p) == /\ Runnable(p)
          /\ ~Full
          /\ buffer' = Append(buffer, p)
          /\ NotifyAll("cond")

\* fn put, the loop condition is true:  queue = self.cond.wait(queue)
PutWait(p) == /\ Runnable(p)
              /\ Full
              /\ Wait(p, "cond")
              /\ UNCHANGED buffer

\* fn take, `while queue.is_empty()` is false:
\*     queue.pop_front();  self.cond.notify_all();
Take(c) == /\ Runnable(c)
           /\ ~Empty
           /\ buffer' = Tail(buffer)
           /\ NotifyAll("cond")

\* fn take, the loop condition is true:  queue = self.cond.wait(queue)
TakeWait(c) == /\ Runnable(c)
               /\ Empty
               /\ Wait(c, "cond")
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
