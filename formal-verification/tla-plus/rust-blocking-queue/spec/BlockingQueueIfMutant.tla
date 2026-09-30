------------------------ MODULE BlockingQueueIfMutant ------------------------
(***************************************************************************)
(* MUTANT, spec only (there is no such code in src/).  The fixed design    *)
(* with the textbook Condvar mistake in put(): testing the condition with  *)
(* `if` instead of `while`, so a thread back from wait() does not re-test: *)
(*                                                                         *)
(*     if queue.len() == self.capacity {                                   *)
(*         queue = self.not_full.wait(queue).unwrap();                     *)
(*     }                                                                   *)
(*     queue.push_back(item);                                              *)
(*                                                                         *)
(* It exists to show that the design modules really model the `while`      *)
(* re-test, and that BoundedBuffer is not vacuous.  TLC finds the overflow *)
(* even with Spurious = FALSE: the woken producer can lose the Mutex to a  *)
(* producer that just arrived and refills the queue first.                 *)
(***************************************************************************)
EXTENDS BlockingQueueCommon

VARIABLE resumed   \* producers that slept in the `if`: they push without re-testing
mvars == <<buffer, waiting, resumed>>

Init == /\ buffer = <<>>
        /\ waiting = [cv \in {"not_full", "not_empty"} |-> {}]
        /\ resumed = {}

\* The `if` was false, or p is back from wait(): push without re-testing.
Put(p) == /\ Runnable(p)
          /\ ~Full \/ p \in resumed
          /\ buffer' = Append(buffer, p)
          /\ NotifyOne("not_empty")
          /\ resumed' = resumed \ {p}

PutWait(p) == /\ Runnable(p)
              /\ Full /\ p \notin resumed
              /\ Wait(p, "not_full")
              /\ resumed' = resumed \cup {p}
              /\ UNCHANGED buffer

\* take() is left as in BlockingQueueFixed (with its `while`).
Take(c) == /\ Runnable(c)
           /\ ~Empty
           /\ buffer' = Tail(buffer)
           /\ NotifyOne("not_full")
           /\ UNCHANGED resumed

TakeWait(c) == /\ Runnable(c)
               /\ Empty
               /\ Wait(c, "not_empty")
               /\ UNCHANGED <<buffer, resumed>>

Next == \/ \E p \in Producers : Put(p) \/ PutWait(p)
        \/ \E c \in Consumers : Take(c) \/ TakeWait(c)
        \/ SpuriousWakeup /\ UNCHANGED resumed

Spec == Init /\ [][Next]_mvars
=============================================================================
