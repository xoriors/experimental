//! A bounded blocking queue built from [`std::sync::Mutex`] and [`std::sync::Condvar`],
//! in three variants that differ only in how they use condition variables:
//!
//! | variant       | Condvars                  | wake-up      | TLC verdict (`spec/`)            |
//! |---------------|---------------------------|--------------|----------------------------------|
//! | [`Buggy`]     | one, shared by both sides | `notify_one` | can deadlock if threads > 2×cap  |
//! | [`Fixed`]     | `not_full` + `not_empty`  | `notify_one` | deadlock-free                    |
//! | [`NotifyAll`] | one, shared by both sides | `notify_all` | deadlock-free, wakes everybody   |
//!
//! Each variant can report its critical sections to a [`Tracer`], which is how
//! `src/bin/trace.rs` records logs for trace validation against the TLA+ specs.
//!
//! ```
//! use blocking_queue::{BlockingQueue, Fixed};
//!
//! let q = Fixed::new(2);
//! q.put("a");
//! q.put("b");
//! assert_eq!(q.take(), "a");
//! ```

mod buggy;
mod fixed;
pub mod harness;
mod notify_all;
pub mod trace;

use std::fmt;
use std::str::FromStr;
use std::sync::Arc;

pub use buggy::Buggy;
pub use fixed::Fixed;
pub use notify_all::NotifyAll;
pub use trace::{Event, Tracer};

/// The API shared by the three variants, so tests, demos and tracing can be generic.
pub trait BlockingQueue<T>: Send + Sync {
    /// A queue that holds at most `capacity` items (`capacity` must be at least 1).
    fn new(capacity: usize) -> Self
    where
        Self: Sized,
    {
        Self::with_tracer(capacity, None)
    }

    /// Like [`BlockingQueue::new`], reporting every critical section to `tracer`.
    fn with_tracer(capacity: usize, tracer: Option<Box<dyn Tracer<T>>>) -> Self
    where
        Self: Sized;

    /// Appends `item`, blocking while the queue is full.
    fn put(&self, item: T);

    /// Removes and returns the oldest item, blocking while the queue is empty.
    fn take(&self) -> T;
}

/// Reports `event` to the tracer, if there is one. Called with the queue's Mutex held.
#[inline]
fn emit<T>(tracer: &Option<Box<dyn Tracer<T>>>, event: Event<'_, T>) {
    if let Some(tracer) = tracer {
        tracer.event(event);
    }
}

/// The three designs, for binaries and tests that pick one at run time.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Variant {
    Buggy,
    Fixed,
    NotifyAll,
}

impl Variant {
    pub const ALL: [Variant; 3] = [Variant::Buggy, Variant::Fixed, Variant::NotifyAll];

    /// The name used on the command line and as the spec's `Variant` constant.
    pub fn name(self) -> &'static str {
        match self {
            Variant::Buggy => "buggy",
            Variant::Fixed => "fixed",
            Variant::NotifyAll => "notify_all",
        }
    }

    /// The TLA+ module that specifies this design.
    pub fn spec_module(self) -> &'static str {
        match self {
            Variant::Buggy => "BlockingQueue",
            Variant::Fixed => "BlockingQueueFixed",
            Variant::NotifyAll => "BlockingQueueNotifyAll",
        }
    }

    /// A new queue of this design.
    pub fn build<T: Send + 'static>(
        self,
        capacity: usize,
        tracer: Option<Box<dyn Tracer<T>>>,
    ) -> Arc<dyn BlockingQueue<T>> {
        match self {
            Variant::Buggy => Arc::new(Buggy::with_tracer(capacity, tracer)),
            Variant::Fixed => Arc::new(Fixed::with_tracer(capacity, tracer)),
            Variant::NotifyAll => Arc::new(NotifyAll::with_tracer(capacity, tracer)),
        }
    }
}

impl fmt::Display for Variant {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.name())
    }
}

impl FromStr for Variant {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Variant::ALL
            .into_iter()
            .find(|v| v.name() == s)
            .ok_or_else(|| format!("unknown variant {s:?} (expected buggy, fixed or notify_all)"))
    }
}
