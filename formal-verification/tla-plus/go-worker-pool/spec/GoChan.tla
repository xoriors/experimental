------------------------------- MODULE GoChan -------------------------------
(***************************************************************************)
(* Go channels as plain TLA+ values, shared by every spec in this folder.  *)
(*                                                                         *)
(* A channel is a record [buf, cap, closed].  Each operator below is one   *)
(* atomic step of the Go runtime: chansend, chanrecv and closechan all     *)
(* run under the channel's internal lock (runtime/chan.go), so no other    *)
(* goroutine can observe a half-done send, receive or close.               *)
(*                                                                         *)
(* The rules, quoted from The Go Programming Language Specification:       *)
(*                                                                         *)
(*  send  "Communication blocks until the send can proceed. [...] A send   *)
(*        on a buffered channel can proceed if there is room in the        *)
(*        buffer. A send on a closed channel proceeds by causing a         *)
(*        run-time panic."                                                 *)
(*        So a send that is blocked on a full buffer when the channel is   *)
(*        closed also panics: SendReady becomes TRUE and SendPanics holds. *)
(*                                                                         *)
(*  recv  "After calling close, and after any previously sent values have  *)
(*        been received, receive operations will return the zero value     *)
(*        [...] without blocking."  Buffered values are still delivered    *)
(*        after close; ok = FALSE (and `for v := range ch` ends) only once *)
(*        the channel is closed AND drained.                               *)
(*                                                                         *)
(*  close "Sending to or closing a closed channel causes a run-time panic."*)
(*                                                                         *)
(* Scope: SEND semantics are modelled for buffered channels (cap >= 1)     *)
(* only.  An unbuffered send is a rendezvous with a receiver, which this   *)
(* module does not model; the pools reject queueSize < 1 in New for that   *)
(* reason.  A cap-0 channel that nobody ever sends on (a "quit" channel    *)
(* that is only closed and received from) IS covered: RecvReady is then   *)
(* exactly "closed".                                                       *)
(*                                                                         *)
(* Abstraction (argued in README.md): which of several blocked senders     *)
(* (or receivers) gets a freed slot is left nondeterministic, whereas the  *)
(* runtime serves its wait queues in FIFO order.  That is a SUPERSET of    *)
(* the runtime's behaviours -- exactly the freedom the language spec       *)
(* leaves -- so a safety property proved here holds for the real runtime.  *)
(***************************************************************************)
EXTENDS Naturals, Sequences

\* make(chan T, cap)
Chan(cap) == [buf |-> <<>>, cap |-> cap, closed |-> FALSE]

\* Type invariant for a channel of element type Values and capacity cap.
IsChan(ch, Values, cap) ==
    /\ ch.cap = cap
    /\ ch.closed \in BOOLEAN
    /\ ch.buf \in Seq(Values)
    /\ Len(ch.buf) <= cap

\* ---- ch <- v -------------------------------------------------------------
\* The send can take its (single) step: it completes or it panics.
\* While this is FALSE the sending goroutine is blocked.
SendReady(ch)  == ch.closed \/ Len(ch.buf) < ch.cap
SendPanics(ch) == ch.closed                          \* "send on closed channel"
Send(ch, v)    == [ch EXCEPT !.buf = Append(@, v)]

\* ---- v, ok := <-ch    (and one iteration of `for v := range ch`) --------
RecvReady(ch)  == ch.closed \/ Len(ch.buf) > 0
RecvOK(ch)     == Len(ch.buf) > 0                    \* FALSE only if closed and drained
RecvValue(ch)  == Head(ch.buf)
Recv(ch)       == [ch EXCEPT !.buf = Tail(@)]        \* use only when RecvOK(ch)

\* ---- close(ch) -----------------------------------------------------------
ClosePanics(ch) == ch.closed                         \* "close of closed channel"
Close(ch)       == [ch EXCEPT !.closed = TRUE]

\* The runtime's panic messages (runtime.plainError strings).
SendOnClosed  == "send on closed channel"
CloseOfClosed == "close of closed channel"
=============================================================================
