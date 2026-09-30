---------------------------- MODULE TraceFixedExtraWakeup ----------------------------
\* A real run of src/fixed.rs: 2 producer(s) x 3 item(s), 2 consumer(s), capacity 1.
\* Trial 1 of `trace`: every thread returned. 22 records, 10 of them waits.
\* Takes that test FIFO order (items of 2+ producers queued): 0.
\* Written by src/bin/trace.rs. Checked by TraceFixedExtraWakeup.cfg; see TraceBlockingQueue.tla.
EXTENDS TraceBlockingQueue

TraceProducers == {"p1", "p2"}
TraceConsumers == {"c1", "c2"}
TraceCapacity  == 1
TraceBlocked   == {}
TraceLog == <<
    [t |-> "p2", op |-> "put",  item |-> "p2"],   \* 1
    [t |-> "p2", op |-> "wait", item |-> ""],     \* 2
    [t |-> "c1", op |-> "take", item |-> "p2"],   \* 3
    [t |-> "c1", op |-> "wait", item |-> ""],     \* 4
    [t |-> "p2", op |-> "put",  item |-> "p2"],   \* 5
    [t |-> "p2", op |-> "wait", item |-> ""],     \* 6
    [t |-> "p1", op |-> "wait", item |-> ""],     \* 7
    [t |-> "c1", op |-> "take", item |-> "p2"],   \* 8
    [t |-> "c1", op |-> "wait", item |-> ""],     \* 9
    [t |-> "p1", op |-> "put",  item |-> "p1"],   \* 10
    [t |-> "p2", op |-> "wait", item |-> ""],     \* 11
    [t |-> "p1", op |-> "wait", item |-> ""],     \* 12
    [t |-> "c2", op |-> "take", item |-> "p1"],   \* 13
    [t |-> "p2", op |-> "put",  item |-> "p2"],   \* 14
    [t |-> "c2", op |-> "take", item |-> "p2"],   \* 15
    [t |-> "c2", op |-> "wait", item |-> ""],     \* 16
    [t |-> "c1", op |-> "wait", item |-> ""],     \* 17
    [t |-> "p1", op |-> "put",  item |-> "p1"],   \* 18
    [t |-> "p1", op |-> "wait", item |-> ""],     \* 19
    [t |-> "c2", op |-> "take", item |-> "p1"],   \* 20
    [t |-> "p1", op |-> "put",  item |-> "p1"],   \* 21
    [t |-> "c1", op |-> "take", item |-> "p1"]    \* 22
>>
=============================================================================
