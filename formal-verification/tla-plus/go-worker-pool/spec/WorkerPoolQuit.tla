---------------------------- MODULE WorkerPoolQuit ----------------------------
(***************************************************************************)
(* Model of quitchan/pool.go -- the "never close the job channel" design.  *)
(* Shutdown closes a separate quit channel (once, via sync.Once) and waits *)
(* for the workers.  Submit selects between <-p.quit and p.jobs <- job.    *)
(* A worker selects between <-p.jobs and <-p.quit; once quit fires it      *)
(* drains p.jobs with a non-blocking select and exits.  Nothing is ever    *)
(* sent on a closed channel, so it cannot panic -- but it loses work.      *)
(*                                                                         *)
(* SELECT, per the Go spec: "If one or more of the communications can      *)
(* proceed, a single one that can proceed is chosen via a uniform          *)
(* pseudo-random selection. Otherwise, if there is a default case, that    *)
(* case is chosen. If there is no default case, the select statement       *)
(* blocks until at least one of the communications can proceed."           *)
(* A select is one atomic step (runtime.selectgo locks all its channels),  *)
(* modelled as `either` over its cases, each guarded by "this case can     *)
(* proceed": the step is enabled iff some case is ready, and TLC explores  *)
(* every ready case -- exactly the outcomes that have non-zero probability *)
(* under uniform random choice.  The order in which cases are WRITTEN      *)
(* gives no priority, and neither does this model.  A `default` case is an *)
(* if/else on readiness.                                                   *)
(*                                                                         *)
(* p.quit is unbuffered and nobody ever sends on it, so the only thing     *)
(* that matters about it is whether it is closed: RecvReady(quit) is       *)
(* exactly quit.closed (GoChan.tla).  sync.Once.Do(f) is one step here     *)
(* because f = close(p.quit) is itself one atomic step and Do makes every  *)
(* concurrent caller wait until f has returned.                            *)
(*                                                                         *)
(* The atomicity argument of WorkerPoolFixed.tla applies unchanged: every  *)
(* label is one atomic channel/select/WaitGroup/Once operation or the      *)
(* opaque handler.                                                         *)
(***************************************************************************)
EXTENDS GoChan, Naturals, Sequences, FiniteSets

CONSTANTS Clients, ShutdownCallers, Workers, QueueSize, NoJob

ASSUME /\ QueueSize \in Nat \ {0}
       /\ Clients \cap ShutdownCallers = {}
       /\ Clients \cap Workers = {}
       /\ ShutdownCallers \cap Workers = {}

Jobs == Clients

(* --algorithm WorkerPoolQuit {
variables
    \* ---- fields of quitchan.Pool --------------------------------------------
    once    = FALSE,                  \* p.once: has Do run f?
    quit    = Chan(0),                \* p.quit = make(chan struct{})
    running = Cardinality(Workers),   \* p.workers counter
    jobs    = Chan(QueueSize),        \* p.jobs = make(chan J, queueSize); never closed
    \* ---- history variables ----------------------------------------------------
    accepted = {},
    rejected = {},
    handled  = [j \in Jobs |-> 0],
    panics   = {};

\* p.jobs <- job, as a select case (same semantics as a plain send).
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

\* Submit(job)
fair process (client \in Clients) {
c_select:   \* select {
            either {
                \* case <-p.quit: return ErrClosed
                await RecvReady(quit);
                rejected := rejected \cup {self};
            } or {
                \* case p.jobs <- job: return nil
                send_job(self);
            };
}

\* Shutdown()
fair process (shutdown \in ShutdownCallers) {
sd_quit:    \* p.once.Do(func() { close(p.quit) })
            if (~once) {
                once := TRUE;
                if (ClosePanics(quit)) {
                    panics := panics \cup {<<self, CloseOfClosed>>};
                    goto Done;
                } else {
                    quit := Close(quit);
                };
            };
sd_wait_workers: \* p.workers.Wait(), then return
            await running = 0;
}

\* work(): defer p.workers.Done(); for { select { ... } }
fair process (worker \in Workers)
variables job = NoJob; {
w_select:   \* select {
            either {
                \* case job := <-p.jobs
                \* (p.jobs is never closed, so a ready receive always has a value)
                await RecvReady(jobs);
                job := RecvValue(jobs);
                jobs := Recv(jobs);
            } or {
                \* case <-p.quit: go drain
                await RecvReady(quit);
                goto w_drain;
            };
w_handle:   \* p.handler(job)
            handled[job] := handled[job] + 1;
            goto w_select;
w_drain:    \* select { case job := <-p.jobs: ...; default: return }
            if (RecvReady(jobs)) {
                job := RecvValue(jobs);
                jobs := Recv(jobs);
            } else {
                goto w_exit;
            };
w_drain_handle: \* p.handler(job)
            handled[job] := handled[job] + 1;
            goto w_drain;
w_exit:     \* deferred p.workers.Done()
            running := running - 1;
}
} *)
\* BEGIN TRANSLATION
VARIABLES once, quit, running, jobs, accepted, rejected, handled, panics, pc, 
          job

vars == << once, quit, running, jobs, accepted, rejected, handled, panics, pc, 
           job >>

ProcSet == (Clients) \cup (ShutdownCallers) \cup (Workers)

Init == (* Global variables *)
        /\ once = FALSE
        /\ quit = Chan(0)
        /\ running = Cardinality(Workers)
        /\ jobs = Chan(QueueSize)
        /\ accepted = {}
        /\ rejected = {}
        /\ handled = [j \in Jobs |-> 0]
        /\ panics = {}
        (* Process worker *)
        /\ job = [self \in Workers |-> NoJob]
        /\ pc = [self \in ProcSet |-> CASE self \in Clients -> "c_select"
                                        [] self \in ShutdownCallers -> "sd_quit"
                                        [] self \in Workers -> "w_select"]

c_select(self) == /\ pc[self] = "c_select"
                  /\ \/ /\ RecvReady(quit)
                        /\ rejected' = (rejected \cup {self})
                        /\ pc' = [pc EXCEPT ![self] = "Done"]
                        /\ UNCHANGED <<jobs, accepted, panics>>
                     \/ /\ SendReady(jobs)
                        /\ IF SendPanics(jobs)
                              THEN /\ panics' = (panics \cup {<<self, SendOnClosed>>})
                                   /\ pc' = [pc EXCEPT ![self] = "Done"]
                                   /\ UNCHANGED << jobs, accepted >>
                              ELSE /\ jobs' = Send(jobs, self)
                                   /\ accepted' = (accepted \cup {self})
                                   /\ pc' = [pc EXCEPT ![self] = "Done"]
                                   /\ UNCHANGED panics
                        /\ UNCHANGED rejected
                  /\ UNCHANGED << once, quit, running, handled, job >>

client(self) == c_select(self)

sd_quit(self) == /\ pc[self] = "sd_quit"
                 /\ IF ~once
                       THEN /\ once' = TRUE
                            /\ IF ClosePanics(quit)
                                  THEN /\ panics' = (panics \cup {<<self, CloseOfClosed>>})
                                       /\ pc' = [pc EXCEPT ![self] = "Done"]
                                       /\ quit' = quit
                                  ELSE /\ quit' = Close(quit)
                                       /\ pc' = [pc EXCEPT ![self] = "sd_wait_workers"]
                                       /\ UNCHANGED panics
                       ELSE /\ pc' = [pc EXCEPT ![self] = "sd_wait_workers"]
                            /\ UNCHANGED << once, quit, panics >>
                 /\ UNCHANGED << running, jobs, accepted, rejected, handled, 
                                 job >>

sd_wait_workers(self) == /\ pc[self] = "sd_wait_workers"
                         /\ running = 0
                         /\ pc' = [pc EXCEPT ![self] = "Done"]
                         /\ UNCHANGED << once, quit, running, jobs, accepted, 
                                         rejected, handled, panics, job >>

shutdown(self) == sd_quit(self) \/ sd_wait_workers(self)

w_select(self) == /\ pc[self] = "w_select"
                  /\ \/ /\ RecvReady(jobs)
                        /\ job' = [job EXCEPT ![self] = RecvValue(jobs)]
                        /\ jobs' = Recv(jobs)
                        /\ pc' = [pc EXCEPT ![self] = "w_handle"]
                     \/ /\ RecvReady(quit)
                        /\ pc' = [pc EXCEPT ![self] = "w_drain"]
                        /\ UNCHANGED <<jobs, job>>
                  /\ UNCHANGED << once, quit, running, accepted, rejected, 
                                  handled, panics >>

w_handle(self) == /\ pc[self] = "w_handle"
                  /\ handled' = [handled EXCEPT ![job[self]] = handled[job[self]] + 1]
                  /\ pc' = [pc EXCEPT ![self] = "w_select"]
                  /\ UNCHANGED << once, quit, running, jobs, accepted, 
                                  rejected, panics, job >>

w_drain(self) == /\ pc[self] = "w_drain"
                 /\ IF RecvReady(jobs)
                       THEN /\ job' = [job EXCEPT ![self] = RecvValue(jobs)]
                            /\ jobs' = Recv(jobs)
                            /\ pc' = [pc EXCEPT ![self] = "w_drain_handle"]
                       ELSE /\ pc' = [pc EXCEPT ![self] = "w_exit"]
                            /\ UNCHANGED << jobs, job >>
                 /\ UNCHANGED << once, quit, running, accepted, rejected, 
                                 handled, panics >>

w_drain_handle(self) == /\ pc[self] = "w_drain_handle"
                        /\ handled' = [handled EXCEPT ![job[self]] = handled[job[self]] + 1]
                        /\ pc' = [pc EXCEPT ![self] = "w_drain"]
                        /\ UNCHANGED << once, quit, running, jobs, accepted, 
                                        rejected, panics, job >>

w_exit(self) == /\ pc[self] = "w_exit"
                /\ running' = running - 1
                /\ pc' = [pc EXCEPT ![self] = "Done"]
                /\ UNCHANGED << once, quit, jobs, accepted, rejected, handled, 
                                panics, job >>

worker(self) == w_select(self) \/ w_handle(self) \/ w_drain(self)
                   \/ w_drain_handle(self) \/ w_exit(self)

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
\* The same properties as WorkerPoolFixed.tla.
TypeOK ==
    /\ once \in BOOLEAN
    /\ IsChan(quit, {}, 0)
    /\ running \in 0..Cardinality(Workers)
    /\ IsChan(jobs, Jobs, QueueSize)
    /\ jobs.closed = FALSE
    /\ accepted \subseteq Jobs
    /\ rejected \subseteq Jobs
    /\ accepted \cap rejected = {}
    /\ handled \in [Jobs -> Nat]
    /\ panics \subseteq ProcSet \X {SendOnClosed, CloseOfClosed}
    /\ job \in [Workers -> Jobs \cup {NoJob}]

NoPanic == panics = {}

HandledAtMostOnce     == \A j \in Jobs : handled[j] <= 1
HandledOnlyIfAccepted == \A j \in Jobs : handled[j] > 0 => j \in accepted

ShutdownDrains ==
    \A s \in ShutdownCallers :
        pc[s] = "Done" => \A j \in accepted : handled[j] = 1

RejectOnlyAfterShutdown == rejected /= {} => quit.closed

AcceptedEventuallyHandled == \A j \in Jobs : j \in accepted ~> handled[j] = 1
=============================================================================
