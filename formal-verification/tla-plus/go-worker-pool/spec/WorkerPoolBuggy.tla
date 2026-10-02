--------------------------- MODULE WorkerPoolBuggy ---------------------------
(***************************************************************************)
(* Model of buggy/pool.go -- the time-of-check/time-of-use race.  Submit   *)
(* checks p.closed under p.mu, unlocks, and only THEN sends on p.jobs;     *)
(* Shutdown sets p.closed and closes p.jobs.  If Shutdown runs between     *)
(* Submit's check and its send, the send panics.  WorkerPoolFixed.tla      *)
(* differs from this module only in the lines marked FIX there.            *)
(*                                                                         *)
(* One process per goroutine: every client calls Submit once (N Submits    *)
(* from one goroutine are a subset of the interleavings of N clients, so   *)
(* more clients covers that case), every ShutdownCaller calls Shutdown     *)
(* once (two of them = concurrent AND repeated calls), and one process per *)
(* worker goroutine started by New.                                        *)
(*                                                                         *)
(* ATOMICITY -- why each label is one step.  Goroutines run in parallel,  *)
(* but the code is free of data races in the Go memory model's sense      *)
(* (p.closed is only touched under p.mu; channels and WaitGroups          *)
(* synchronise), so by the model's DRF-SC guarantee every execution is an  *)
(* interleaving of atomic steps.  Only steps on SHARED state matter, and   *)
(* each label holds exactly one such operation, atomic in Go, or one      *)
(* critical section:                                                       *)
(*  - A channel send/receive/close is atomic (runtime lock inside hchan).  *)
(*  - WaitGroup.Add/Done/Wait are atomic operations on its counter.        *)
(*  - A critical section p.mu.Lock() ... p.mu.Unlock() is one step: every  *)
(*    access to p.closed happens under p.mu, nothing inside it blocks, and *)
(*    by Lipton's reduction (Lock is a right mover, Unlock a left mover)   *)
(*    each interleaving is equivalent to one where the section runs        *)
(*    without interruption.  So the mutex itself needs no variable: it is  *)
(*    never observed held between two steps.  In WorkerPoolFixed, the      *)
(*    p.senders.Add(1) inside Submit's section is not protected by p.mu    *)
(*    against Wait, but Wait cannot be pending while it runs: Shutdown     *)
(*    only reaches Wait after setting p.closed under p.mu, and a Submit    *)
(*    that sees closed = FALSE finishes its section (and its Add) before   *)
(*    that.  For the fixed pool this is not just argued:                   *)
(*    WorkerPoolFixedMutex.tla makes the mutex explicit, one step per      *)
(*    statement, and TLC checks that it refines WorkerPoolFixed.tla.  The  *)
(*    buggy pool's critical sections are the same, minus the Add.          *)
(*  - Local computation (if first ..., return ...) is invisible to other   *)
(*    goroutines and is folded into the neighbouring step.                 *)
(*  - The handler is user code that does not touch the pool; it is one     *)
(*    step whose only effect is "job handled".                             *)
(* Every place where another goroutine can interleave and change an        *)
(* outcome is a label boundary; the test hooks (testHookXxx in pool.go)    *)
(* sit on the boundaries the counterexample replay needs.                  *)
(***************************************************************************)
EXTENDS GoChan, Naturals, Sequences, FiniteSets

CONSTANTS Clients,          \* goroutines that call Submit (once each)
          ShutdownCallers,  \* goroutines that call Shutdown (once each)
          Workers,          \* worker goroutines started by New
          QueueSize,        \* cap(p.jobs)
          NoJob             \* model value: a worker's `job` before its first receive

ASSUME /\ QueueSize \in Nat \ {0}         \* New rejects queueSize < 1 (see GoChan)
       /\ Clients \cap ShutdownCallers = {}
       /\ Clients \cap Workers = {}
       /\ ShutdownCallers \cap Workers = {}

Jobs == Clients                 \* the job submitted by client c is called c

(* --algorithm WorkerPoolBuggy {
variables
    \* ---- fields of the Pool struct -----------------------------------------
    closed  = FALSE,                  \* p.closed, guarded by p.mu
    running = Cardinality(Workers),   \* p.workers counter: p.workers.Add(workers) in New
    jobs    = Chan(QueueSize),        \* p.jobs = make(chan J, queueSize)
    \* ---- history variables: not in the code, only what the properties need --
    accepted = {},                    \* jobs whose send succeeded: Submit returns nil
    rejected = {},                    \* jobs whose Submit returned ErrClosed
    handled  = [j \in Jobs |-> 0],    \* how many times handler(j) ran
    panics   = {};                    \* <<goroutine, message>> of every runtime panic

\* p.jobs <- job.  Blocks while the buffer is full and p.jobs is open; panics
\* if p.jobs is closed, including when it was closed while this send was
\* blocked; otherwise the job is in the queue and Submit will return nil.
macro send_job(job) {
    await SendReady(jobs);
    if (SendPanics(jobs)) {
        panics := panics \cup {<<self, SendOnClosed>>};
        goto Done;                    \* the goroutine unwinds
    } else {
        jobs := Send(jobs, job);
        accepted := accepted \cup {job};
    }
}

\* close(p.jobs)
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
c_admit:    \* p.mu.Lock(); if p.closed { p.mu.Unlock(); return ErrClosed }
            \* p.mu.Unlock()
            if (closed) {
                rejected := rejected \cup {self};
                goto Done;
            };
c_send:     \* testHookSubmitAdmitted(); p.jobs <- job; return nil
            send_job(self);
}

\* Shutdown()
fair process (shutdown \in ShutdownCallers) {
sd_mark:    \* p.mu.Lock(); first := !p.closed; p.closed = true; p.mu.Unlock()
            \* if !first: skip to p.workers.Wait()
            if (closed) goto sd_wait_workers
            else closed := TRUE;
sd_close:   \* testHookShutdownMarked(); close(p.jobs); testHookShutdownClosed()
            close_jobs();
sd_wait_workers: \* p.workers.Wait(), then return
            await running = 0;
}

\* work(): defer p.workers.Done(); for job := range p.jobs { p.handler(job) }
fair process (worker \in Workers)
variables job = NoJob; {
w_recv:     \* one iteration of `for job := range p.jobs`
            await RecvReady(jobs);
            if (RecvOK(jobs)) {
                job := RecvValue(jobs);
                jobs := Recv(jobs);
            } else {
                goto w_exit;          \* closed and drained: the loop ends
            };
w_handle:   \* p.handler(job)
            handled[job] := handled[job] + 1;
            goto w_recv;
w_exit:     \* deferred p.workers.Done()
            running := running - 1;
}
} *)
\* BEGIN TRANSLATION
VARIABLES closed, running, jobs, accepted, rejected, handled, panics, pc, job

vars == << closed, running, jobs, accepted, rejected, handled, panics, pc, 
           job >>

ProcSet == (Clients) \cup (ShutdownCallers) \cup (Workers)

Init == (* Global variables *)
        /\ closed = FALSE
        /\ running = Cardinality(Workers)
        /\ jobs = Chan(QueueSize)
        /\ accepted = {}
        /\ rejected = {}
        /\ handled = [j \in Jobs |-> 0]
        /\ panics = {}
        (* Process worker *)
        /\ job = [self \in Workers |-> NoJob]
        /\ pc = [self \in ProcSet |-> CASE self \in Clients -> "c_admit"
                                        [] self \in ShutdownCallers -> "sd_mark"
                                        [] self \in Workers -> "w_recv"]

c_admit(self) == /\ pc[self] = "c_admit"
                 /\ IF closed
                       THEN /\ rejected' = (rejected \cup {self})
                            /\ pc' = [pc EXCEPT ![self] = "Done"]
                       ELSE /\ pc' = [pc EXCEPT ![self] = "c_send"]
                            /\ UNCHANGED rejected
                 /\ UNCHANGED << closed, running, jobs, accepted, handled, 
                                 panics, job >>

c_send(self) == /\ pc[self] = "c_send"
                /\ SendReady(jobs)
                /\ IF SendPanics(jobs)
                      THEN /\ panics' = (panics \cup {<<self, SendOnClosed>>})
                           /\ pc' = [pc EXCEPT ![self] = "Done"]
                           /\ UNCHANGED << jobs, accepted >>
                      ELSE /\ jobs' = Send(jobs, self)
                           /\ accepted' = (accepted \cup {self})
                           /\ pc' = [pc EXCEPT ![self] = "Done"]
                           /\ UNCHANGED panics
                /\ UNCHANGED << closed, running, rejected, handled, job >>

client(self) == c_admit(self) \/ c_send(self)

sd_mark(self) == /\ pc[self] = "sd_mark"
                 /\ IF closed
                       THEN /\ pc' = [pc EXCEPT ![self] = "sd_wait_workers"]
                            /\ UNCHANGED closed
                       ELSE /\ closed' = TRUE
                            /\ pc' = [pc EXCEPT ![self] = "sd_close"]
                 /\ UNCHANGED << running, jobs, accepted, rejected, handled, 
                                 panics, job >>

sd_close(self) == /\ pc[self] = "sd_close"
                  /\ IF ClosePanics(jobs)
                        THEN /\ panics' = (panics \cup {<<self, CloseOfClosed>>})
                             /\ pc' = [pc EXCEPT ![self] = "Done"]
                             /\ jobs' = jobs
                        ELSE /\ jobs' = Close(jobs)
                             /\ pc' = [pc EXCEPT ![self] = "sd_wait_workers"]
                             /\ UNCHANGED panics
                  /\ UNCHANGED << closed, running, accepted, rejected, handled, 
                                  job >>

sd_wait_workers(self) == /\ pc[self] = "sd_wait_workers"
                         /\ running = 0
                         /\ pc' = [pc EXCEPT ![self] = "Done"]
                         /\ UNCHANGED << closed, running, jobs, accepted, 
                                         rejected, handled, panics, job >>

shutdown(self) == sd_mark(self) \/ sd_close(self) \/ sd_wait_workers(self)

w_recv(self) == /\ pc[self] = "w_recv"
                /\ RecvReady(jobs)
                /\ IF RecvOK(jobs)
                      THEN /\ job' = [job EXCEPT ![self] = RecvValue(jobs)]
                           /\ jobs' = Recv(jobs)
                           /\ pc' = [pc EXCEPT ![self] = "w_handle"]
                      ELSE /\ pc' = [pc EXCEPT ![self] = "w_exit"]
                           /\ UNCHANGED << jobs, job >>
                /\ UNCHANGED << closed, running, accepted, rejected, handled, 
                                panics >>

w_handle(self) == /\ pc[self] = "w_handle"
                  /\ handled' = [handled EXCEPT ![job[self]] = handled[job[self]] + 1]
                  /\ pc' = [pc EXCEPT ![self] = "w_recv"]
                  /\ UNCHANGED << closed, running, jobs, accepted, rejected, 
                                  panics, job >>

w_exit(self) == /\ pc[self] = "w_exit"
                /\ running' = running - 1
                /\ pc' = [pc EXCEPT ![self] = "Done"]
                /\ UNCHANGED << closed, jobs, accepted, rejected, handled, 
                                panics, job >>

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
(***************************************************************************)
(* Safety properties (invariants).                                         *)
(***************************************************************************)
TypeOK ==
    /\ closed \in BOOLEAN
    /\ running \in 0..Cardinality(Workers)
    /\ IsChan(jobs, Jobs, QueueSize)
    /\ accepted \subseteq Jobs
    /\ rejected \subseteq Jobs
    /\ accepted \cap rejected = {}
    /\ handled \in [Jobs -> Nat]
    /\ panics \subseteq ProcSet \X {SendOnClosed, CloseOfClosed}
    /\ job \in [Workers -> Jobs \cup {NoJob}]

\* No goroutine ever panics: no send on a closed channel, no double close.
NoPanic == panics = {}

\* No job is handled twice, and only accepted jobs are handled at all.
HandledAtMostOnce     == \A j \in Jobs : handled[j] <= 1
HandledOnlyIfAccepted == \A j \in Jobs : handled[j] > 0 => j \in accepted

\* Once ANY Shutdown call has returned, every job whose Submit returned nil
\* has been handled exactly once ("process every accepted job").
ShutdownDrains ==
    \A s \in ShutdownCallers :
        pc[s] = "Done" => \A j \in accepted : handled[j] = 1

\* ErrClosed only once shutdown has started.
RejectOnlyAfterShutdown == rejected /= {} => closed

(***************************************************************************)
(* Liveness.  Termination (every goroutine -- clients, Shutdown callers,   *)
(* workers -- reaches "Done", i.e. no goroutine leaks and every Submit and *)
(* Shutdown call returns) is generated by the PlusCal translator above.    *)
(* Fairness: `fair process` = weak fairness per goroutine, see README.     *)
(* For the client and shutdown processes it also assumes that Submit and   *)
(* Shutdown are eventually CALLED: their first label is always enabled.    *)
(* WorkerPoolFixed_ShutdownOptional.cfg checks AcceptedEventuallyHandled   *)
(* without that assumption for Shutdown (WorkerPoolFixedProbes.tla).       *)
(***************************************************************************)
AcceptedEventuallyHandled == \A j \in Jobs : j \in accepted ~> handled[j] = 1

=============================================================================
