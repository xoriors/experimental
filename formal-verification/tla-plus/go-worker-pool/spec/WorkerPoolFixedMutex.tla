------------------------ MODULE WorkerPoolFixedMutex ------------------------
(***************************************************************************)
(* fixed/pool.go again, at a finer grain: sync.Mutex is an explicit        *)
(* variable and every statement inside a critical section is its own      *)
(* step, so another goroutine may run between any two of them (blocked    *)
(* only by the mutex, exactly as in Go).                                   *)
(*                                                                         *)
(* WorkerPoolFixed.tla folds each critical section into ONE step and       *)
(* argues that this is sound (Lipton reduction).  This module lets TLC     *)
(* check that argument instead of trusting it: RefinesWorkerPoolFixed      *)
(* asserts that every behaviour of this spec, with the mutex and the local *)
(* `first` hidden and the pc mapped (CoarsePC), satisfies the whole Spec   *)
(* of WorkerPoolFixed: its initial state, its next-state relation up to    *)
(* stuttering ([][Next]_vars) and its weak-fairness conditions.  So every  *)
(* property TLC proves about the coarse spec, liveness included, holds for *)
(* this fine-grained one (in the same model).  Its own invariants and      *)
(* Termination are checked directly as well.                               *)
(***************************************************************************)
EXTENDS GoChan, Naturals, Sequences, FiniteSets

CONSTANTS Clients, ShutdownCallers, Workers, QueueSize, NoJob,
          NoOwner           \* model value: p.mu is not held

ASSUME /\ QueueSize \in Nat \ {0}
       /\ Clients \cap ShutdownCallers = {}
       /\ Clients \cap Workers = {}
       /\ ShutdownCallers \cap Workers = {}

Jobs == Clients

(* --algorithm WorkerPoolFixedMutex {
variables
    mu      = NoOwner,                \* p.mu: which goroutine holds it
    closed  = FALSE,
    senders = 0,
    running = Cardinality(Workers),
    jobs    = Chan(QueueSize),
    accepted = {},
    rejected = {},
    handled  = [j \in Jobs |-> 0],
    panics   = {};

define {
    \* p.mu.Lock() can proceed.  (The mutation model
    \* WorkerPoolFixedMutex_NoExclusion.cfg overrides this with TRUE.)
    LockFree == mu = NoOwner
}

\* sync.Mutex: Lock blocks while another goroutine holds the mutex.
macro lock()   { await LockFree; mu := self; }
macro unlock() { mu := NoOwner; }

macro send_job(job) {
    await SendReady(jobs);
    if (SendPanics(jobs)) {
        panics := panics \cup {<<self, SendOnClosed>>};
        goto Done;
    } else {
        jobs := Send(jobs, job);
        accepted := accepted \cup {job};
    }
}

macro close_jobs() {
    if (ClosePanics(jobs)) {
        panics := panics \cup {<<self, CloseOfClosed>>};
        goto Done;
    } else {
        jobs := Close(jobs);
    }
}

\* Submit(job)
fair process (client \in Clients) {
c_lock:     lock();                           \* p.mu.Lock()
c_check:    if (closed) goto c_reject;        \* if p.closed {
c_add:      senders := senders + 1;           \* p.senders.Add(1)
c_unlock:   unlock();                         \* p.mu.Unlock(); defer p.senders.Done()
c_send:     send_job(self);                   \* p.jobs <- job
c_release:  senders := senders - 1;           \* deferred p.senders.Done(); return nil
            goto Done;
c_reject:   unlock();                         \*   p.mu.Unlock(); return ErrClosed }
            rejected := rejected \cup {self};
}

\* Shutdown()
fair process (shutdown \in ShutdownCallers)
variables first = FALSE; {
sd_lock:    lock();                           \* p.mu.Lock()
sd_read:    first := ~closed;                 \* first := !p.closed
sd_write:   closed := TRUE;                   \* p.closed = true
sd_unlock:  unlock();                         \* p.mu.Unlock()
            if (~first) goto sd_wait_workers; \* if first {
sd_wait_senders: await senders = 0;           \*   p.senders.Wait()
sd_close:   close_jobs();                     \*   close(p.jobs) }
sd_wait_workers: await running = 0;           \* p.workers.Wait()
}

\* work(): unchanged from WorkerPoolFixed
fair process (worker \in Workers)
variables job = NoJob; {
w_recv:     await RecvReady(jobs);
            if (RecvOK(jobs)) {
                job := RecvValue(jobs);
                jobs := Recv(jobs);
            } else {
                goto w_exit;
            };
w_handle:   handled[job] := handled[job] + 1;
            goto w_recv;
w_exit:     running := running - 1;
}
} *)
\* BEGIN TRANSLATION
VARIABLES mu, closed, senders, running, jobs, accepted, rejected, handled, 
          panics, pc

(* define statement *)
LockFree == mu = NoOwner

VARIABLES first, job

vars == << mu, closed, senders, running, jobs, accepted, rejected, handled, 
           panics, pc, first, job >>

ProcSet == (Clients) \cup (ShutdownCallers) \cup (Workers)

Init == (* Global variables *)
        /\ mu = NoOwner
        /\ closed = FALSE
        /\ senders = 0
        /\ running = Cardinality(Workers)
        /\ jobs = Chan(QueueSize)
        /\ accepted = {}
        /\ rejected = {}
        /\ handled = [j \in Jobs |-> 0]
        /\ panics = {}
        (* Process shutdown *)
        /\ first = [self \in ShutdownCallers |-> FALSE]
        (* Process worker *)
        /\ job = [self \in Workers |-> NoJob]
        /\ pc = [self \in ProcSet |-> CASE self \in Clients -> "c_lock"
                                        [] self \in ShutdownCallers -> "sd_lock"
                                        [] self \in Workers -> "w_recv"]

c_lock(self) == /\ pc[self] = "c_lock"
                /\ LockFree
                /\ mu' = self
                /\ pc' = [pc EXCEPT ![self] = "c_check"]
                /\ UNCHANGED << closed, senders, running, jobs, accepted, 
                                rejected, handled, panics, first, job >>

c_check(self) == /\ pc[self] = "c_check"
                 /\ IF closed
                       THEN /\ pc' = [pc EXCEPT ![self] = "c_reject"]
                       ELSE /\ pc' = [pc EXCEPT ![self] = "c_add"]
                 /\ UNCHANGED << mu, closed, senders, running, jobs, accepted, 
                                 rejected, handled, panics, first, job >>

c_add(self) == /\ pc[self] = "c_add"
               /\ senders' = senders + 1
               /\ pc' = [pc EXCEPT ![self] = "c_unlock"]
               /\ UNCHANGED << mu, closed, running, jobs, accepted, rejected, 
                               handled, panics, first, job >>

c_unlock(self) == /\ pc[self] = "c_unlock"
                  /\ mu' = NoOwner
                  /\ pc' = [pc EXCEPT ![self] = "c_send"]
                  /\ UNCHANGED << closed, senders, running, jobs, accepted, 
                                  rejected, handled, panics, first, job >>

c_send(self) == /\ pc[self] = "c_send"
                /\ SendReady(jobs)
                /\ IF SendPanics(jobs)
                      THEN /\ panics' = (panics \cup {<<self, SendOnClosed>>})
                           /\ pc' = [pc EXCEPT ![self] = "Done"]
                           /\ UNCHANGED << jobs, accepted >>
                      ELSE /\ jobs' = Send(jobs, self)
                           /\ accepted' = (accepted \cup {self})
                           /\ pc' = [pc EXCEPT ![self] = "c_release"]
                           /\ UNCHANGED panics
                /\ UNCHANGED << mu, closed, senders, running, rejected, 
                                handled, first, job >>

c_release(self) == /\ pc[self] = "c_release"
                   /\ senders' = senders - 1
                   /\ pc' = [pc EXCEPT ![self] = "Done"]
                   /\ UNCHANGED << mu, closed, running, jobs, accepted, 
                                   rejected, handled, panics, first, job >>

c_reject(self) == /\ pc[self] = "c_reject"
                  /\ mu' = NoOwner
                  /\ rejected' = (rejected \cup {self})
                  /\ pc' = [pc EXCEPT ![self] = "Done"]
                  /\ UNCHANGED << closed, senders, running, jobs, accepted, 
                                  handled, panics, first, job >>

client(self) == c_lock(self) \/ c_check(self) \/ c_add(self)
                   \/ c_unlock(self) \/ c_send(self) \/ c_release(self)
                   \/ c_reject(self)

sd_lock(self) == /\ pc[self] = "sd_lock"
                 /\ LockFree
                 /\ mu' = self
                 /\ pc' = [pc EXCEPT ![self] = "sd_read"]
                 /\ UNCHANGED << closed, senders, running, jobs, accepted, 
                                 rejected, handled, panics, first, job >>

sd_read(self) == /\ pc[self] = "sd_read"
                 /\ first' = [first EXCEPT ![self] = ~closed]
                 /\ pc' = [pc EXCEPT ![self] = "sd_write"]
                 /\ UNCHANGED << mu, closed, senders, running, jobs, accepted, 
                                 rejected, handled, panics, job >>

sd_write(self) == /\ pc[self] = "sd_write"
                  /\ closed' = TRUE
                  /\ pc' = [pc EXCEPT ![self] = "sd_unlock"]
                  /\ UNCHANGED << mu, senders, running, jobs, accepted, 
                                  rejected, handled, panics, first, job >>

sd_unlock(self) == /\ pc[self] = "sd_unlock"
                   /\ mu' = NoOwner
                   /\ IF ~first[self]
                         THEN /\ pc' = [pc EXCEPT ![self] = "sd_wait_workers"]
                         ELSE /\ pc' = [pc EXCEPT ![self] = "sd_wait_senders"]
                   /\ UNCHANGED << closed, senders, running, jobs, accepted, 
                                   rejected, handled, panics, first, job >>

sd_wait_senders(self) == /\ pc[self] = "sd_wait_senders"
                         /\ senders = 0
                         /\ pc' = [pc EXCEPT ![self] = "sd_close"]
                         /\ UNCHANGED << mu, closed, senders, running, jobs, 
                                         accepted, rejected, handled, panics, 
                                         first, job >>

sd_close(self) == /\ pc[self] = "sd_close"
                  /\ IF ClosePanics(jobs)
                        THEN /\ panics' = (panics \cup {<<self, CloseOfClosed>>})
                             /\ pc' = [pc EXCEPT ![self] = "Done"]
                             /\ jobs' = jobs
                        ELSE /\ jobs' = Close(jobs)
                             /\ pc' = [pc EXCEPT ![self] = "sd_wait_workers"]
                             /\ UNCHANGED panics
                  /\ UNCHANGED << mu, closed, senders, running, accepted, 
                                  rejected, handled, first, job >>

sd_wait_workers(self) == /\ pc[self] = "sd_wait_workers"
                         /\ running = 0
                         /\ pc' = [pc EXCEPT ![self] = "Done"]
                         /\ UNCHANGED << mu, closed, senders, running, jobs, 
                                         accepted, rejected, handled, panics, 
                                         first, job >>

shutdown(self) == sd_lock(self) \/ sd_read(self) \/ sd_write(self)
                     \/ sd_unlock(self) \/ sd_wait_senders(self)
                     \/ sd_close(self) \/ sd_wait_workers(self)

w_recv(self) == /\ pc[self] = "w_recv"
                /\ RecvReady(jobs)
                /\ IF RecvOK(jobs)
                      THEN /\ job' = [job EXCEPT ![self] = RecvValue(jobs)]
                           /\ jobs' = Recv(jobs)
                           /\ pc' = [pc EXCEPT ![self] = "w_handle"]
                      ELSE /\ pc' = [pc EXCEPT ![self] = "w_exit"]
                           /\ UNCHANGED << jobs, job >>
                /\ UNCHANGED << mu, closed, senders, running, accepted, 
                                rejected, handled, panics, first >>

w_handle(self) == /\ pc[self] = "w_handle"
                  /\ handled' = [handled EXCEPT ![job[self]] = handled[job[self]] + 1]
                  /\ pc' = [pc EXCEPT ![self] = "w_recv"]
                  /\ UNCHANGED << mu, closed, senders, running, jobs, accepted, 
                                  rejected, panics, first, job >>

w_exit(self) == /\ pc[self] = "w_exit"
                /\ running' = running - 1
                /\ pc' = [pc EXCEPT ![self] = "Done"]
                /\ UNCHANGED << mu, closed, senders, jobs, accepted, rejected, 
                                handled, panics, first, job >>

worker(self) == w_recv(self) \/ w_handle(self) \/ w_exit(self)

(* Allow infinite stuttering to prevent deadlock on termination. *)
Terminating == /\ \A self \in ProcSet: pc[self] = "Done"
               /\ UNCHANGED vars

Next == (\E self \in Clients: client(self))
           \/ (\E self \in ShutdownCallers: shutdown(self))
           \/ (\E self \in Workers: worker(self))
           \/ Terminating

Spec == /\ Init /\ [][Next]_vars
        /\ \A self \in Clients : WF_vars(client(self))
        /\ \A self \in ShutdownCallers : WF_vars(shutdown(self))
        /\ \A self \in Workers : WF_vars(worker(self))

Termination == <>(\A self \in ProcSet: pc[self] = "Done")

\* END TRANSLATION

-----------------------------------------------------------------------------
TypeOK ==
    /\ mu \in ProcSet \cup {NoOwner}
    /\ closed \in BOOLEAN
    /\ senders \in 0..Cardinality(Clients)
    /\ running \in 0..Cardinality(Workers)
    /\ IsChan(jobs, Jobs, QueueSize)
    /\ accepted \subseteq Jobs
    /\ rejected \subseteq Jobs
    /\ accepted \cap rejected = {}
    /\ handled \in [Jobs -> Nat]
    /\ panics \subseteq ProcSet \X {SendOnClosed, CloseOfClosed}
    /\ job \in [Workers -> Jobs \cup {NoJob}]
    /\ first \in [ShutdownCallers -> BOOLEAN]

\* The critical sections, and a check that the lock macro really excludes.
InCriticalSection(p) ==
    pc[p] \in {"c_check", "c_add", "c_unlock", "c_reject", "sd_read", "sd_write", "sd_unlock"}
MutualExclusion ==
    \A p, q \in ProcSet : InCriticalSection(p) /\ InCriticalSection(q) => p = q

NoPanic == panics = {}
HandledAtMostOnce     == \A j \in Jobs : handled[j] <= 1
HandledOnlyIfAccepted == \A j \in Jobs : handled[j] > 0 => j \in accepted
ShutdownDrains ==
    \A s \in ShutdownCallers :
        pc[s] = "Done" => \A j \in accepted : handled[j] = 1
RejectOnlyAfterShutdown == rejected /= {} => closed

(***************************************************************************)
(* Refinement mapping to WorkerPoolFixed.  Steps that only move the mutex  *)
(* or a local variable map to stuttering steps of the coarse spec; the one *)
(* step of each critical section that writes shared state (c_add,          *)
(* c_reject, sd_write) maps to the coarse critical-section step.  For that *)
(* to be a coarse step, the value read earlier in the section (closed at   *)
(* c_check and sd_read) must still hold at the writing step -- which is    *)
(* exactly what the mutex guarantees, and exactly what TLC verifies here.  *)
(* Coarse!Spec also contains the coarse weak-fairness conjuncts, so the    *)
(* check covers liveness too; a violation of the [][Next]_vars part is     *)
(* reported as "Action property ... is violated".                          *)
(***************************************************************************)
CoarsePC(p) ==
    CASE pc[p] \in {"c_lock", "c_check", "c_add", "c_reject"} -> "c_admit"
      [] pc[p] = "c_unlock"                                   -> "c_send"
      [] pc[p] \in {"sd_lock", "sd_read", "sd_write"}         -> "sd_mark"
      [] pc[p] = "sd_unlock" -> IF first[p] THEN "sd_wait_senders" ELSE "sd_wait_workers"
      [] OTHER               -> pc[p]

Coarse == INSTANCE WorkerPoolFixed WITH pc <- [p \in ProcSet |-> CoarsePC(p)]

RefinesWorkerPoolFixed == Coarse!Spec

\* Mutation: a "mutex" that never blocks (see WorkerPoolFixedMutex_NoExclusion.cfg).
BrokenLockFree == TRUE
=============================================================================
