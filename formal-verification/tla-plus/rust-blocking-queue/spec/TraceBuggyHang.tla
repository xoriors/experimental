---------------------------- MODULE TraceBuggyHang ----------------------------
\* A real run of src/buggy.rs: 2 producer(s) x 3 item(s), 1 consumer(s), capacity 1.
\* Trial 1 of `trace --until-hang`: HUNG, blocked for good: p1, p2, c1. 8 records, 5 of them waits.
\* Takes that test FIFO order (items of 2+ producers queued): 0.
\* Written by src/bin/trace.rs. Checked by TraceBuggyHang.cfg; see TraceBlockingQueue.tla.
EXTENDS TraceBlockingQueue

TraceProducers == {"p1", "p2"}
TraceConsumers == {"c1"}
TraceCapacity  == 1
TraceBlocked   == {"p1", "p2", "c1"}
TraceLog == <<
    [t |-> "p1", op |-> "put",  item |-> "p1"],   \* 1
    [t |-> "p1", op |-> "wait", item |-> ""],     \* 2
    [t |-> "p2", op |-> "wait", item |-> ""],     \* 3
    [t |-> "c1", op |-> "take", item |-> "p1"],   \* 4
    [t |-> "c1", op |-> "wait", item |-> ""],     \* 5
    [t |-> "p1", op |-> "put",  item |-> "p1"],   \* 6
    [t |-> "p1", op |-> "wait", item |-> ""],     \* 7
    [t |-> "p2", op |-> "wait", item |-> ""]      \* 8
>>
=============================================================================
