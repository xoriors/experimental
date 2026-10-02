---------------------------- MODULE TraceFixedRoleSwapped ----------------------------
\* HAND-CORRUPTED copy of TraceFixedOk.tla: record 4, c1's take, is attributed to the
\* producer p1, as a driver that named its threads wrongly could have logged it.  p1 is
\* asleep at that point, but with spurious wakeups allowed it could be awake, and the
\* buffer does hold "p1": only the role check rejects the record.
\* TraceFixedRoleSwapped.cfg expects TLC to REJECT the log; TraceFixedRoleSwappedPrefix.cfg
\* that records 1..3 still match, so matching fails exactly at record 4.
EXTENDS TraceBlockingQueue

TraceProducers == {"p1", "p2"}
TraceConsumers == {"c1"}
TraceCapacity  == 1
TraceBlocked   == {}
TraceLog == <<
    [t |-> "p1", op |-> "put",  item |-> "p1"],   \* 1
    [t |-> "p1", op |-> "wait", item |-> ""],     \* 2
    [t |-> "p2", op |-> "wait", item |-> ""],     \* 3
    [t |-> "p1", op |-> "take", item |-> "p1"],   \* 4 (was c1)
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
