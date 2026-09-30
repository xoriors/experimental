-------------------- MODULE BlockingQueueTransitionMutant --------------------
(***************************************************************************)
(* MUTANT, spec only (there is no such code in src/).  The fixed design    *)
(* with a popular "optimisation": notify only when the queue changes from  *)
(* empty to non-empty (put) or from full to non-full (take), since only    *)
(* then can anybody be waiting:                                            *)
(*                                                                         *)
(*     let was_empty = queue.is_empty();                                   *)
(*     queue.push_back(item);                                              *)
(*     if was_empty { self.not_empty.notify_one(); }                       *)
(*                                                                         *)
(* It loses wakeups: two consumers wait on an empty queue, two puts arrive *)
(* back to back, and only the first one notifies, so the second consumer   *)
(* sleeps next to an item.  It exists to show that ConsumerAwake counts:   *)
(* no deadlock, no "some consumer is awake" violation and no loss of       *)
(* Progress happens in a spec whose threads never quit, because the one    *)
(* awake consumer drains the queue forever.  A program whose threads DO    *)
(* quit hangs (BlockingQueueWorkload, Workload_Mutant_P1C2K2).             *)
(***************************************************************************)
EXTENDS BlockingQueueCommon

CondVars == {"not_full", "not_empty"}

Init == /\ buffer = <<>>
        /\ waiting = [cv \in CondVars |-> {}]

\* The mutation: notify only if the put made the queue non-empty.
Put(p) == /\ Runnable(p)
          /\ ~Full
          /\ buffer' = Append(buffer, p)
          /\ IF Empty THEN NotifyOne("not_empty") ELSE UNCHANGED waiting

PutWait(p) == /\ Runnable(p)
              /\ Full
              /\ Wait(p, "not_full")
              /\ UNCHANGED buffer

\* The mutation: notify only if the take made the queue non-full.
Take(c) == /\ Runnable(c)
           /\ ~Empty
           /\ buffer' = Tail(buffer)
           /\ IF Full THEN NotifyOne("not_full") ELSE UNCHANGED waiting

TakeWait(c) == /\ Runnable(c)
               /\ Empty
               /\ Wait(c, "not_empty")
               /\ UNCHANGED buffer

Next == \/ \E p \in Producers : Put(p) \/ PutWait(p)
        \/ \E c \in Consumers : Take(c) \/ TakeWait(c)
        \/ SpuriousWakeup

Spec == Init /\ [][Next]_vars
=============================================================================
