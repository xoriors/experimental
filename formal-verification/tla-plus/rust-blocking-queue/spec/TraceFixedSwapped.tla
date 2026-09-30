---------------------------- MODULE TraceFixedSwapped ----------------------------
\* HAND-CORRUPTED copy of TraceFixedOk.tla: records 9 and 10 are swapped, as a tracer
\* that logged AFTER releasing the Mutex could have written them.  The log now claims
\* that c1 found the queue empty (record 10) right after p2 had filled it (record 9).
\* TraceFixedSwapped.cfg expects TLC to REJECT the log; TraceFixedSwappedPrefix.cfg
\* that records 1..9 still match, so matching fails exactly at record 10.
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
    [t |-> "p2", op |-> "put",  item |-> "p2"],   \* 9  (was record 10)
    [t |-> "c1", op |-> "wait", item |-> ""],     \* 10 (was record 9)
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
