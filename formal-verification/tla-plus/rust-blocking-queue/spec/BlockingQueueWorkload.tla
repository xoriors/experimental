------------------------ MODULE BlockingQueueWorkload ------------------------
(***************************************************************************)
(* FINITE WORKLOADS.  In the design modules every thread loops forever.    *)
(* Real programs (src/harness.rs, and so `make demo`, `make trace` and the *)
(* tests) give each thread a quota and let it return when done, and a      *)
(* returned thread takes no further steps.  That can strand threads the    *)
(* loop-forever spec never would: once the awake consumer has taken its    *)
(* share and returned, nobody else takes the item a sleeping consumer was  *)
(* never woken for.  So "does every balanced run finish?" is its own       *)
(* question, and this module asks it of the unchanged design actions.      *)
(*                                                                         *)
(* Balanced as in the harness: every item put is taken.  Every producer    *)
(* puts Items items and every consumer takes Takes items (the harness also *)
(* splits uneven totals; these models use even ones).                      *)
(***************************************************************************)
EXTENDS BlockingQueueDesigns   \* the design to run: constant Variant

CONSTANTS Items, Takes   \* put() calls per producer, take() calls per consumer

ASSUME /\ Items \in Nat /\ Takes \in Nat
       /\ Cardinality(Producers) * Items = Cardinality(Consumers) * Takes

VARIABLE left   \* left[t]: put()/take() calls thread t has not completed yet
wvars == <<buffer, waiting, left>>

WInit == /\ DInit
         /\ left = [t \in Threads |-> IF t \in Producers THEN Items ELSE Takes]

Completed(t) == left' = [left EXCEPT ![t] = @ - 1]

\* A thread with calls left runs the design's step; one without has returned.
\* A blocked thread is inside a call, so it always has calls left.
WProducer(p) == /\ left[p] > 0
                /\ \/ DPut(p) /\ Completed(p)
                   \/ DPutWait(p) /\ UNCHANGED left
WConsumer(c) == /\ left[c] > 0
                /\ \/ DTake(c) /\ Completed(c)
                   \/ DTakeWait(c) /\ UNCHANGED left

Finished == \A t \in Threads : left[t] = 0

WNext == \/ \E p \in Producers : WProducer(p)
         \/ \E c \in Consumers : WConsumer(c)
         \/ SpuriousWakeup /\ UNCHANGED left
         \/ Finished /\ UNCHANGED wvars   \* every thread returned: done, not deadlocked

\* F2, as in the design modules: a runnable thread with calls left gets to run.
WSpec == /\ WInit /\ [][WNext]_wvars
         /\ \A p \in Producers : WF_wvars(WProducer(p))
         /\ \A c \in Consumers : WF_wvars(WConsumer(c))

\* The program's hang: threads with calls left, and every one of them blocked.
\* (With Spurious = FALSE this is exactly TLC's deadlock check.)
NoHang == ~Finished => \E t \in Threads : left[t] > 0 /\ Runnable(t)

\* Every balanced run finishes: all threads return.
Terminates == <>Finished
=============================================================================
