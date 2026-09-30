---------------------------- MODULE TraceFixedFifo ----------------------------
\* A real run of src/fixed.rs: 2 producer(s) x 3 item(s), 1 consumer(s), capacity 2.
\* Trial 1 of `trace`: every thread returned. 16 records, 4 of them waits.
\* Takes that test FIFO order (items of 2+ producers queued): 1.
\* Written by src/bin/trace.rs. Checked by TraceFixedFifo.cfg; see TraceBlockingQueue.tla.
EXTENDS TraceBlockingQueue

TraceProducers == {"p1", "p2"}
TraceConsumers == {"c1"}
TraceCapacity  == 2
TraceBlocked   == {}
TraceLog == <<
    [t |-> "p1", op |-> "put",  item |-> "p1"],   \* 1
    [t |-> "p1", op |-> "put",  item |-> "p1"],   \* 2
    [t |-> "p1", op |-> "wait", item |-> ""],     \* 3
    [t |-> "p2", op |-> "wait", item |-> ""],     \* 4
    [t |-> "c1", op |-> "take", item |-> "p1"],   \* 5
    [t |-> "c1", op |-> "take", item |-> "p1"],   \* 6
    [t |-> "p2", op |-> "put",  item |-> "p2"],   \* 7
    [t |-> "p2", op |-> "put",  item |-> "p2"],   \* 8
    [t |-> "p2", op |-> "wait", item |-> ""],     \* 9
    [t |-> "p1", op |-> "wait", item |-> ""],     \* 10
    [t |-> "c1", op |-> "take", item |-> "p2"],   \* 11
    [t |-> "p2", op |-> "put",  item |-> "p2"],   \* 12
    [t |-> "c1", op |-> "take", item |-> "p2"],   \* 13
    [t |-> "p1", op |-> "put",  item |-> "p1"],   \* 14
    [t |-> "c1", op |-> "take", item |-> "p2"],   \* 15
    [t |-> "c1", op |-> "take", item |-> "p1"]    \* 16
>>
=============================================================================
