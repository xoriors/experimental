---------------------------- MODULE TraceFixedOk ----------------------------
\* A real run of src/fixed.rs: 2 producer(s) x 3 item(s), 1 consumer(s), capacity 1.
\* Trial 1 of `trace`: every thread returned. 22 records, 10 of them waits.
\* Takes that test FIFO order (items of 2+ producers queued): 0.
\* Written by src/bin/trace.rs. Checked by TraceFixedOk.cfg; see TraceBlockingQueue.tla.
EXTENDS TraceBlockingQueue

TraceProducers == {"p1", "p2"}
TraceConsumers == {"c1"}
TraceCapacity  == 1
TraceBlocked   == {}
TraceLog == <<
    [t |-> "p1", op |-> "put",  item |-> "p1"],   \* 1
    [t |-> "p1", op |-> "wait", item |-> ""],     \* 2
    [t |-> "p2", op |-> "wait", item |-> ""],     \* 3
    [t |-> "c1", op |-> "take", item |-> "p1"],   \* 4
    [t |-> "c1", op |-> "wait", item |-> ""],     \* 5
    [t |-> "p1", op |-> "put",  item |-> "p1"],   \* 6
    [t |-> "p1", op |-> "wait", item |-> ""],     \* 7
    [t |-> "c1", op |-> "take", item |-> "p1"],   \* 8
    [t |-> "c1", op |-> "wait", item |-> ""],     \* 9
    [t |-> "p2", op |-> "put",  item |-> "p2"],   \* 10
    [t |-> "p2", op |-> "wait", item |-> ""],     \* 11
    [t |-> "c1", op |-> "take", item |-> "p2"],   \* 12
    [t |-> "c1", op |-> "wait", item |-> ""],     \* 13
    [t |-> "p1", op |-> "put",  item |-> "p1"],   \* 14
    [t |-> "c1", op |-> "take", item |-> "p1"],   \* 15
    [t |-> "c1", op |-> "wait", item |-> ""],     \* 16
    [t |-> "p2", op |-> "put",  item |-> "p2"],   \* 17
    [t |-> "p2", op |-> "wait", item |-> ""],     \* 18
    [t |-> "c1", op |-> "take", item |-> "p2"],   \* 19
    [t |-> "c1", op |-> "wait", item |-> ""],     \* 20
    [t |-> "p2", op |-> "put",  item |-> "p2"],   \* 21
    [t |-> "c1", op |-> "take", item |-> "p2"]    \* 22
>>
=============================================================================
