//! Tracing hook and TLA+ log writer: the code side of trace validation
//! (spec/TraceBlockingQueue.tla).
//!
//! Every queue calls its [`Tracer`] exactly once per critical section, *while holding the
//! queue's Mutex*. Critical sections are serialised by that Mutex, so the order in which a
//! tracer sees events is the order in which they really happened: a linearization of the
//! run, with no clock or timestamp involved. One event is one step of the TLA+ spec:
//!
//! | event                | code                                       | spec action          |
//! |----------------------|--------------------------------------------|----------------------|
//! | `Event::Put(&item)`  | `put`: loop condition false, `push_back`   | `Put(p)`             |
//! | `Event::Take(&item)` | `take`: loop condition false, `pop_front`  | `Take(c)`            |
//! | `Event::Wait`        | loop condition true, about to call `wait`  | `PutWait`/`TakeWait` |
//!
//! Returning from `wait` is not an event of its own: the returning thread re-tests the loop
//! condition in the same critical section, which then ends in one of the three events above.
//! Which waiter a `notify_one` woke, and any spurious wakeup, are invisible to the code;
//! TLC reconstructs them.

use std::collections::VecDeque;
use std::fmt::{self, Display, Write as _};
use std::sync::{Arc, Mutex};
use std::thread;

/// What a queue did in one critical section.
#[derive(Debug)]
pub enum Event<'a, T> {
    /// `put` found room and is appending `item`.
    Put(&'a T),
    /// `take` found an item and removed `item`.
    Take(&'a T),
    /// The calling `put`/`take` found the queue full/empty and is about to `wait`.
    Wait,
}

// An event only borrows the item, so it can be copied whatever `T` is (a derive would
// demand `T: Copy`).
impl<T> Clone for Event<'_, T> {
    fn clone(&self) -> Self {
        *self
    }
}

impl<T> Copy for Event<'_, T> {}

/// Observer of a queue's critical sections.
///
/// `event` runs with the queue's Mutex held: it must be quick, must not block for long, and
/// must never call back into the queue.
pub trait Tracer<T>: Send + Sync {
    fn event(&self, event: Event<'_, T>);
}

/// The kind of a recorded event.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Op {
    Put,
    Take,
    Wait,
}

impl Op {
    fn name(self) -> &'static str {
        match self {
            Op::Put => "put",
            Op::Take => "take",
            Op::Wait => "wait",
        }
    }
}

/// One recorded event: which thread (by name), what it did, and to which item.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Record {
    pub thread: String,
    pub op: Op,
    pub item: Option<String>,
}

/// A [`Tracer`] that appends every event to a shared log, naming the thread by
/// [`std::thread::Thread::name`] (the spec's thread ids are those names).
///
/// Its own Mutex is only ever taken inside the queue's critical section, so it is never
/// contended and cannot deadlock with it.
#[derive(Clone, Default)]
pub struct Recorder(Arc<Mutex<Vec<Record>>>);

impl Recorder {
    pub fn new() -> Self {
        Self::default()
    }

    /// A copy of the log so far.
    pub fn snapshot(&self) -> Vec<Record> {
        self.0.lock().unwrap().clone()
    }
}

impl<T: Display> Tracer<T> for Recorder {
    fn event(&self, event: Event<'_, T>) {
        let (op, item) = match event {
            Event::Put(item) => (Op::Put, Some(item.to_string())),
            Event::Take(item) => (Op::Take, Some(item.to_string())),
            Event::Wait => (Op::Wait, None),
        };
        let current = thread::current();
        let thread = current.name().unwrap_or("unnamed").to_owned();
        self.0.lock().unwrap().push(Record { thread, op, item });
    }
}

/// How many takes in `records` could tell FIFO order from any other order: those that ran
/// while the queue (replayed from the log) held items of two or more producers. Trace
/// validation checks `Head(buffer) = item`, so it tests FIFO order only at these takes; a
/// log where this is 0 (always so at capacity 1) would pass with a LIFO queue too.
pub fn fifo_tests(records: &[Record]) -> usize {
    let mut queue: VecDeque<&str> = VecDeque::new();
    let mut tests = 0;
    for record in records {
        match (record.op, record.item.as_deref()) {
            (Op::Put, Some(item)) => queue.push_back(item),
            (Op::Take, _) => {
                let head = queue.pop_front();
                if queue.iter().any(|item| Some(*item) != head) {
                    tests += 1;
                }
            }
            _ => {}
        }
    }
    tests
}

/// A recorded run, ready to be written out as a TLA+ module that EXTENDS
/// `TraceBlockingQueue` plus the TLC model (`.cfg`) that checks it.
pub struct TraceModule<'a> {
    /// Module name; also the file stem of the `.tla` and `.cfg` files.
    pub name: &'a str,
    /// The design whose run was recorded; the model checks the log against its spec.
    pub variant: crate::Variant,
    pub producers: &'a [String],
    pub consumers: &'a [String],
    pub capacity: usize,
    /// Threads still blocked in `wait` when the log was cut (empty if all returned).
    pub blocked: &'a [String],
    pub records: &'a [Record],
    /// Free text for the header comment: how the log was produced.
    pub provenance: &'a str,
}

/// A TLA+ string literal.
fn tla_string(s: &str) -> String {
    format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
}

/// A TLA+ set of string literals.
fn tla_set(items: &[String]) -> String {
    let items: Vec<String> = items.iter().map(|s| tla_string(s)).collect();
    format!("{{{}}}", items.join(", "))
}

impl TraceModule<'_> {
    /// The `.tla` module: the log as a sequence of records plus the run's constants.
    pub fn tla(&self) -> String {
        let mut out = String::new();
        let dashes = "-".repeat(28);
        writeln!(out, "{dashes} MODULE {} {dashes}", self.name).unwrap();
        for line in self.provenance.lines() {
            writeln!(out, "\\* {line}").unwrap();
        }
        writeln!(
            out,
            "\\* Written by src/bin/trace.rs. Checked by {}.cfg; see TraceBlockingQueue.tla.",
            self.name
        )
        .unwrap();
        writeln!(out, "EXTENDS TraceBlockingQueue\n").unwrap();
        writeln!(out, "TraceProducers == {}", tla_set(self.producers)).unwrap();
        writeln!(out, "TraceConsumers == {}", tla_set(self.consumers)).unwrap();
        writeln!(out, "TraceCapacity  == {}", self.capacity).unwrap();
        writeln!(out, "TraceBlocked   == {}", tla_set(self.blocked)).unwrap();
        writeln!(out, "TraceLog == <<").unwrap();
        for (i, r) in self.records.iter().enumerate() {
            let sep = if i + 1 < self.records.len() { "," } else { "" };
            let op = format!("{},", tla_string(r.op.name()));
            let item = tla_string(r.item.as_deref().unwrap_or(""));
            let thread = tla_string(&r.thread);
            let entry = format!("[t |-> {thread}, op |-> {op:<7} item |-> {item}]{sep}");
            writeln!(out, "    {entry:<46}\\* {}", i + 1).unwrap();
        }
        writeln!(out, ">>").unwrap();
        writeln!(out, "{}", "=".repeat(77)).unwrap();
        out
    }

    /// A TLC model checking the log against `variant`'s spec. With `expect_accepted` the
    /// model carries the EXPECT header `tools/tla.sh check` needs (a matching behaviour
    /// exists); without it, `check` skips the model.
    pub fn cfg(&self, variant: crate::Variant, spurious: bool, expect_accepted: bool) -> String {
        let mut out = String::new();
        if expect_accepted {
            writeln!(out, "\\* SPEC: {}.tla", self.name).unwrap();
            writeln!(out, "\\* EXPECT: accepted NoBehaviourMatchesLog").unwrap();
            writeln!(
                out,
                "\\* WHY: accepted: a real {} log is a behaviour of {} (TLC's counterexample is the witness)",
                self.variant,
                variant.spec_module()
            )
            .unwrap();
        } else {
            writeln!(
                out,
                "\\* {}.tla against {}, Spurious = {}",
                self.name,
                variant.spec_module(),
                tla_bool(spurious)
            )
            .unwrap();
            writeln!(
                out,
                "\\* Informational, no expected outcome: `tools/tla.sh check` skips it."
            )
            .unwrap();
        }
        writeln!(out, "CONSTANTS").unwrap();
        writeln!(out, "    Variant   = {}", tla_string(variant.name())).unwrap();
        writeln!(out, "    Spurious  = {}", tla_bool(spurious)).unwrap();
        writeln!(out, "    Producers <- TraceProducers").unwrap();
        writeln!(out, "    Consumers <- TraceConsumers").unwrap();
        writeln!(out, "    Capacity  <- TraceCapacity").unwrap();
        writeln!(out, "    Blocked   <- TraceBlocked").unwrap();
        writeln!(out, "    Log       <- TraceLog").unwrap();
        writeln!(out, "INIT TraceInit").unwrap();
        writeln!(out, "NEXT TraceNext").unwrap();
        writeln!(out, "INVARIANT NoBehaviourMatchesLog").unwrap();
        writeln!(out, "CHECK_DEADLOCK FALSE").unwrap();
        out
    }
}

fn tla_bool(b: bool) -> &'static str {
    if b { "TRUE" } else { "FALSE" }
}

impl fmt::Display for Record {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.item {
            Some(item) => write!(f, "{} {} {}", self.thread, self.op.name(), item),
            None => write!(f, "{} {}", self.thread, self.op.name()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Variant;

    fn rec(thread: &str, op: Op, item: Option<&str>) -> Record {
        Record {
            thread: thread.into(),
            op,
            item: item.map(Into::into),
        }
    }

    #[test]
    fn writes_the_log_as_a_tla_module() {
        let records = [
            rec("p1", Op::Put, Some("p1")),
            rec("p2", Op::Wait, None),
            rec("c1", Op::Take, Some("p1")),
        ];
        let module = TraceModule {
            name: "TraceTiny",
            variant: Variant::Fixed,
            producers: &["p1".into(), "p2".into()],
            consumers: &["c1".into()],
            capacity: 1,
            blocked: &["p2".into()],
            records: &records,
            provenance: "a hand-made example",
        };
        let expected = r#"---------------------------- MODULE TraceTiny ----------------------------
\* a hand-made example
\* Written by src/bin/trace.rs. Checked by TraceTiny.cfg; see TraceBlockingQueue.tla.
EXTENDS TraceBlockingQueue

TraceProducers == {"p1", "p2"}
TraceConsumers == {"c1"}
TraceCapacity  == 1
TraceBlocked   == {"p2"}
TraceLog == <<
    [t |-> "p1", op |-> "put",  item |-> "p1"],   \* 1
    [t |-> "p2", op |-> "wait", item |-> ""],     \* 2
    [t |-> "c1", op |-> "take", item |-> "p1"]    \* 3
>>
=============================================================================
"#;
        assert_eq!(module.tla(), expected);
        let cfg = module.cfg(Variant::Fixed, true, true);
        assert!(
            cfg.starts_with(
                "\\* SPEC: TraceTiny.tla\n\\* EXPECT: accepted NoBehaviourMatchesLog\n"
            )
        );
        assert!(cfg.contains("    Variant   = \"fixed\"\n    Spurious  = TRUE\n"));
        assert!(
            !module
                .cfg(Variant::Buggy, false, false)
                .contains("\\* EXPECT:")
        );
    }

    #[test]
    fn counts_the_takes_that_test_fifo_order() {
        let put = |p: &str| rec(p, Op::Put, Some(p));
        let take = |item: &str| rec("c1", Op::Take, Some(item));
        // One producer at a time: any queue discipline gives the same log.
        assert_eq!(
            fifo_tests(&[put("p1"), put("p1"), take("p1"), take("p1")]),
            0
        );
        // p1's item ahead of p2's: the first take tells FIFO from LIFO, the second cannot.
        let log = [put("p1"), put("p2"), take("p1"), take("p2")];
        assert_eq!(fifo_tests(&log), 1);
    }

    #[test]
    fn escapes_tla_strings() {
        assert_eq!(tla_string(r#"a"b\c"#), r#""a\"b\\c""#);
        assert_eq!(tla_set(&[]), "{}");
    }
}
