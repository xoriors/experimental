------------------------ MODULE WorkerPoolFixedProbes ------------------------
(***************************************************************************)
(* Vacuity guards for WorkerPoolFixed, and one weaker environment.         *)
(* The mutation and probe models that use this module are EXPECTED TO      *)
(* FAIL: a failure proves that TLC can see the failure mode or reaches the *)
(* interesting state, so the passing fixed models do not pass merely       *)
(* because nothing interesting ever happens.  The exception is             *)
(* WorkerPoolFixed_ShutdownOptional.cfg, which must pass: the fixed pool   *)
(* makes progress even if Shutdown is never called.                        *)
(*                                                                         *)
(* Kept out of WorkerPoolFixed.tla so that diffing WorkerPoolBuggy.tla     *)
(* against WorkerPoolFixed.tla shows exactly the fix and nothing else.     *)
(***************************************************************************)
EXTENDS WorkerPoolFixed

(***************************************************************************)
(* Mutation: weakened fairness.  The same system, but the Go scheduler is  *)
(* no longer assumed to eventually run a runnable worker.  Expected to     *)
(* violate Termination: the workers may never drain p.jobs, so Shutdown    *)
(* waits in p.workers.Wait() forever.  Shows that Termination is not       *)
(* vacuous and that the fairness assumption on workers is necessary.       *)
(***************************************************************************)
SpecUnfairWorkers ==
    /\ Init /\ [][Next]_vars
    /\ \A self \in Clients : WF_vars(client(self))
    /\ \A self \in ShutdownCallers : WF_vars(shutdown(self))

(***************************************************************************)
(* Environment assumption removed: Shutdown may never be called.           *)
(* `fair process (shutdown ...)` in Spec says more than "the scheduler     *)
(* runs runnable goroutines": sd_mark is always enabled, so it also says   *)
(* the application eventually CALLS Shutdown.  Under that assumption       *)
(* AcceptedEventuallyHandled follows from Termination + ShutdownDrains, so *)
(* WorkerPoolFixed.cfg cannot tell a pool that handles jobs while it runs  *)
(* from one that only handles them on the way out.  This spec drops the    *)
(* Shutdown callers' fairness (they may still run, but need not), so       *)
(* WorkerPoolFixed_ShutdownOptional.cfg checks that a running pool makes   *)
(* progress on its own.                                                    *)
(***************************************************************************)
SpecShutdownOptional ==
    /\ Init /\ [][Next]_vars
    /\ \A self \in Clients : WF_vars(client(self))
    /\ \A self \in Workers : WF_vars(worker(self))

(***************************************************************************)
(* Mutation: lazy workers, which receive nothing until Shutdown has marked *)
(* the pool closed.  Every property of WorkerPoolFixed.cfg still holds for *)
(* them (Shutdown is eventually called and they drain the queue then);     *)
(* under SpecShutdownOptional, AcceptedEventuallyHandled fails             *)
(* (WorkerPoolFixed_LazyWorkers.cfg), which shows that check has teeth.    *)
(***************************************************************************)
lazy_worker(self) == (closed /\ w_recv(self)) \/ w_handle(self) \/ w_exit(self)

NextLazyWorkers ==
    \/ \E self \in Clients : client(self)
    \/ \E self \in ShutdownCallers : shutdown(self)
    \/ \E self \in Workers : lazy_worker(self)
    \/ Terminating

SpecLazyWorkersShutdownOptional ==
    /\ Init /\ [][NextLazyWorkers]_vars
    /\ \A self \in Clients : WF_vars(client(self))
    /\ \A self \in Workers : WF_vars(lazy_worker(self))

(***************************************************************************)
(* Reachability probes.  Probe_X asserts that X NEVER happens; its model   *)
(* expects TLC to report the invariant violated, which proves X is         *)
(* reachable and prints a behaviour that gets there.                       *)
(***************************************************************************)
\* An admitted Submit has not sent yet while the pool is already marked
\* closed: the exact state in which the buggy pool closes p.jobs under the
\* sender's feet.  In the fixed pool, Shutdown now waits in p.senders.Wait().
Probe_SenderInWindow ==
    ~(closed /\ \E c \in Clients : pc[c] = "c_send")

\* Same, with the admitted sender blocked on a full buffer.
Probe_BlockedSenderInWindow ==
    ~(closed /\ ~SendReady(jobs) /\ \E c \in Clients : pc[c] = "c_send")

\* Some Submit gets ErrClosed.
Probe_Rejected == rejected = {}

\* One Shutdown call already waits for the workers while another one has
\* not closed p.jobs yet (concurrent Shutdown calls).
Probe_ConcurrentShutdown ==
    ~\E s, t \in ShutdownCallers :
        pc[s] = "sd_wait_workers" /\ pc[t] \in {"sd_wait_senders", "sd_close"}
=============================================================================
