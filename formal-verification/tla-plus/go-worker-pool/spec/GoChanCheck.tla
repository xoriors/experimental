----------------------------- MODULE GoChanCheck -----------------------------
(***************************************************************************)
(* Unit test for GoChan.tla, independent of the pool: senders, a ranging   *)
(* receiver (or none) and closers use the channel operators directly, and  *)
(* the invariants restate the Go spec's channel rules.  If GoChan got a    *)
(* rule wrong (a value lost or duplicated, a send succeeding after close,  *)
(* the range loop ending before the buffer is drained, a sender blocked on *)
(* a full buffer not woken by close, ...), a model of this module fails.   *)
(*                                                                         *)
(*   go func() { ch <- v }()          // each Sender, once                 *)
(*   go func() { for v := range ch { received = append(received, v) } }() *)
(*                                    // each Receiver: one, or none       *)
(*   go func() { close(ch) }()        // each Closer, once                 *)
(*                                                                         *)
(* With no receiver (GoChanCheck_NoReceiver.cfg) nothing ever frees a      *)
(* slot, so a sender blocked on the full buffer can only finish because    *)
(* close wakes it: that model pins the "ch.closed \/" half of SendReady.   *)
(***************************************************************************)
EXTENDS GoChan, Naturals, Sequences, FiniteSets

CONSTANTS Senders, Receivers, Closers, Cap

ASSUME /\ Cap \in Nat \ {0}
       /\ Senders \cap Closers = {}
       /\ Receivers \cap (Senders \cup Closers) = {}
       /\ Cardinality(Receivers) <= 1        \* one ranging receiver, or none

(* --algorithm GoChanCheck {
variables
    ch = Chan(Cap),
    \* history variables
    sent           = <<>>,   \* values whose send completed, in completion order
    received       = <<>>,   \* values the receiver got with ok = TRUE, in order
    sendPanicked   = {},     \* senders whose send panicked
    closePanicked  = {},     \* closers whose close panicked
    sentAtClose    = 0,      \* Len(sent) when the channel got closed (read only once closed)
    blockedAtClose = {},     \* senders blocked on a full buffer at that moment
    recvAfterClose = FALSE,  \* some value was received after the close
    rangeEnded     = FALSE;  \* the receiver's range loop has ended

fair process (sender \in Senders) {
s_send:     \* ch <- self
            await SendReady(ch);
            if (SendPanics(ch)) {
                sendPanicked := sendPanicked \cup {self};
            } else {
                ch := Send(ch, self);
                sent := Append(sent, self);
            };
}

fair process (receiver \in Receivers) {
r_recv:     \* for v := range ch
            while (TRUE) {
                await RecvReady(ch);
                if (RecvOK(ch)) {
                    received := Append(received, RecvValue(ch));
                    recvAfterClose := recvAfterClose \/ ch.closed;
                    ch := Recv(ch);
                } else {
                    rangeEnded := TRUE;
                    goto Done;
                };
            };
}

fair process (closer \in Closers) {
k_close:    \* close(ch)
            if (ClosePanics(ch)) {
                closePanicked := closePanicked \cup {self};
            } else {
                sentAtClose := Len(sent);
                blockedAtClose := {s \in Senders : pc[s] = "s_send" /\ ~SendReady(ch)};
                ch := Close(ch);
            };
}
} *)
\* BEGIN TRANSLATION
VARIABLES ch, sent, received, sendPanicked, closePanicked, sentAtClose, 
          blockedAtClose, recvAfterClose, rangeEnded, pc

vars == << ch, sent, received, sendPanicked, closePanicked, sentAtClose, 
           blockedAtClose, recvAfterClose, rangeEnded, pc >>

ProcSet == (Senders) \cup (Receivers) \cup (Closers)

Init == (* Global variables *)
        /\ ch = Chan(Cap)
        /\ sent = <<>>
        /\ received = <<>>
        /\ sendPanicked = {}
        /\ closePanicked = {}
        /\ sentAtClose = 0
        /\ blockedAtClose = {}
        /\ recvAfterClose = FALSE
        /\ rangeEnded = FALSE
        /\ pc = [self \in ProcSet |-> CASE self \in Senders -> "s_send"
                                        [] self \in Receivers -> "r_recv"
                                        [] self \in Closers -> "k_close"]

s_send(self) == /\ pc[self] = "s_send"
                /\ SendReady(ch)
                /\ IF SendPanics(ch)
                      THEN /\ sendPanicked' = (sendPanicked \cup {self})
                           /\ UNCHANGED << ch, sent >>
                      ELSE /\ ch' = Send(ch, self)
                           /\ sent' = Append(sent, self)
                           /\ UNCHANGED sendPanicked
                /\ pc' = [pc EXCEPT ![self] = "Done"]
                /\ UNCHANGED << received, closePanicked, sentAtClose, 
                                blockedAtClose, recvAfterClose, rangeEnded >>

sender(self) == s_send(self)

r_recv(self) == /\ pc[self] = "r_recv"
                /\ RecvReady(ch)
                /\ IF RecvOK(ch)
                      THEN /\ received' = Append(received, RecvValue(ch))
                           /\ recvAfterClose' = (recvAfterClose \/ ch.closed)
                           /\ ch' = Recv(ch)
                           /\ pc' = [pc EXCEPT ![self] = "r_recv"]
                           /\ UNCHANGED rangeEnded
                      ELSE /\ rangeEnded' = TRUE
                           /\ pc' = [pc EXCEPT ![self] = "Done"]
                           /\ UNCHANGED << ch, received, recvAfterClose >>
                /\ UNCHANGED << sent, sendPanicked, closePanicked, sentAtClose, 
                                blockedAtClose >>

receiver(self) == r_recv(self)

k_close(self) == /\ pc[self] = "k_close"
                 /\ IF ClosePanics(ch)
                       THEN /\ closePanicked' = (closePanicked \cup {self})
                            /\ UNCHANGED << ch, sentAtClose, blockedAtClose >>
                       ELSE /\ sentAtClose' = Len(sent)
                            /\ blockedAtClose' = {s \in Senders : pc[s] = "s_send" /\ ~SendReady(ch)}
                            /\ ch' = Close(ch)
                            /\ UNCHANGED closePanicked
                 /\ pc' = [pc EXCEPT ![self] = "Done"]
                 /\ UNCHANGED << sent, received, sendPanicked, recvAfterClose, 
                                 rangeEnded >>

closer(self) == k_close(self)

(* Allow infinite stuttering to prevent deadlock on termination. *)
Terminating == /\ \A self \in ProcSet: pc[self] = "Done"
               /\ UNCHANGED vars

Next == (\E self \in Senders: sender(self))
           \/ (\E self \in Receivers: receiver(self))
           \/ (\E self \in Closers: closer(self))
           \/ Terminating

Spec == /\ Init /\ [][Next]_vars
        /\ \A self \in Senders : WF_vars(sender(self))
        /\ \A self \in Receivers : WF_vars(receiver(self))
        /\ \A self \in Closers : WF_vars(closer(self))

Termination == <>(\A self \in ProcSet: pc[self] = "Done")

\* END TRANSLATION

-----------------------------------------------------------------------------
TypeOK == IsChan(ch, Senders, Cap)

\* FIFO, no loss, no duplication: what was received plus what is still
\* buffered is exactly what was sent, in send order.
FIFO == received \o ch.buf = sent

\* A send panics only on a closed channel, and none completes after close.
SendPanicsOnlyIfClosed == sendPanicked /= {} => ch.closed
NoSendAfterClose       == ch.closed => Len(sent) = sentAtClose

\* The range loop ends only when the channel is closed AND drained.
RangeEndsOnlyWhenDrained ==
    rangeEnded => ch.closed /\ ch.buf = <<>> /\ received = sent

\* A sender blocked on a full buffer when the channel is closed panics too.
BlockedSenderPanics ==
    \A s \in blockedAtClose : pc[s] = "Done" => s \in sendPanicked

\* Exactly one close succeeds; every other one panics.
OneCloseSucceeds ==
    (\A c \in Closers : pc[c] = "Done") =>
        Cardinality(closePanicked) = Cardinality(Closers) - 1

\* Probes: each is expected to be VIOLATED (the case is reachable).
Probe_BlockedSenderPanics == ~\E s \in blockedAtClose : s \in sendPanicked
Probe_RecvAfterClose      == ~recvAfterClose
Probe_DoubleClosePanics   == closePanicked = {}
=============================================================================
