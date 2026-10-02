------------------------ MODULE BlockingQueueDesigns ------------------------
(***************************************************************************)
(* One design, chosen by the constant Variant, for the modules that wrap a *)
(* design instead of being one: TraceBlockingQueue.tla (is a log a         *)
(* behaviour of the design?) and BlockingQueueWorkload.tla (does a finite  *)
(* workload always finish?).  The designs are written over the constants   *)
(* and variables of BlockingQueueCommon, so each is instantiated as is:    *)
(* the wrappers check exactly the actions the design modules define.       *)
(***************************************************************************)
EXTENDS BlockingQueueCommon

CONSTANT Variant   \* "buggy" | "fixed" | "notify_all" | "transition_mutant"

ASSUME Variant \in {"buggy", "fixed", "notify_all", "transition_mutant"}

BuggyQ     == INSTANCE BlockingQueue                  \* src/buggy.rs
FixedQ     == INSTANCE BlockingQueueFixed             \* src/fixed.rs
NotifyAllQ == INSTANCE BlockingQueueNotifyAll         \* src/notify_all.rs
MutantQ    == INSTANCE BlockingQueueTransitionMutant  \* spec only

DInit == CASE Variant = "buggy"      -> BuggyQ!Init
           [] Variant = "fixed"      -> FixedQ!Init
           [] Variant = "notify_all" -> NotifyAllQ!Init
           [] OTHER                  -> MutantQ!Init
DPut(p) == CASE Variant = "buggy"      -> BuggyQ!Put(p)
             [] Variant = "fixed"      -> FixedQ!Put(p)
             [] Variant = "notify_all" -> NotifyAllQ!Put(p)
             [] OTHER                  -> MutantQ!Put(p)
DPutWait(p) == CASE Variant = "buggy"      -> BuggyQ!PutWait(p)
                 [] Variant = "fixed"      -> FixedQ!PutWait(p)
                 [] Variant = "notify_all" -> NotifyAllQ!PutWait(p)
                 [] OTHER                  -> MutantQ!PutWait(p)
DTake(c) == CASE Variant = "buggy"      -> BuggyQ!Take(c)
              [] Variant = "fixed"      -> FixedQ!Take(c)
              [] Variant = "notify_all" -> NotifyAllQ!Take(c)
              [] OTHER                  -> MutantQ!Take(c)
DTakeWait(c) == CASE Variant = "buggy"      -> BuggyQ!TakeWait(c)
                  [] Variant = "fixed"      -> FixedQ!TakeWait(c)
                  [] Variant = "notify_all" -> NotifyAllQ!TakeWait(c)
                  [] OTHER                  -> MutantQ!TakeWait(c)
=============================================================================
