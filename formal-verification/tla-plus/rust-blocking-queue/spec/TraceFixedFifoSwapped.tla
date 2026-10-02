---------------------------- MODULE TraceFixedFifoSwapped ----------------------------
\* HAND-CORRUPTED copy of TraceFixedFifo.tla: the items of the takes at records 15 and 16
\* are swapped, which is what a LIFO queue (pop_back instead of pop_front) would have
\* logged.  After record 14 the queue holds <<"p2", "p1">>, so record 15 now claims the
\* newest item.  TraceFixedFifoSwapped.cfg expects TLC to REJECT the log;
\* TraceFixedFifoSwappedPrefix.cfg that records 1..14 still match, so matching fails
\* exactly at the FIFO check of record 15.
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
    [t |-> "c1", op |-> "take", item |-> "p1"],   \* 15 (was "p2")
    [t |-> "c1", op |-> "take", item |-> "p2"]    \* 16 (was "p1")
>>
=============================================================================
