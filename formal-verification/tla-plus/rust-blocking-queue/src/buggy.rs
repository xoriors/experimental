//! BUGGY: one Condvar shared by producers and consumers, woken with `notify_one`.
//!
//! `notify_one` wakes *some* thread blocked on `cond`, possibly one of the same kind as
//! the caller: a producer that wakes another producer (which finds the queue still full and
//! goes back to sleep) has spent the wakeup a sleeping consumer needed. Enough of those and
//! every thread is asleep: a deadlock. TLC finds it once producers + consumers > 2 x
//! capacity; see spec/BlockingQueue.tla. Diff this file against fixed.rs.

use std::collections::VecDeque;
use std::sync::{Condvar, Mutex};

use crate::{BlockingQueue, Event, Tracer, emit};

pub struct Buggy<T> {
    queue: Mutex<VecDeque<T>>,
    capacity: usize,
    cond: Condvar, // "the queue changed": producers AND consumers wait here
    tracer: Option<Box<dyn Tracer<T>>>,
}

impl<T: Send> BlockingQueue<T> for Buggy<T> {
    fn with_tracer(capacity: usize, tracer: Option<Box<dyn Tracer<T>>>) -> Self {
        assert!(capacity > 0, "capacity must be at least 1");
        Buggy {
            queue: Mutex::new(VecDeque::with_capacity(capacity)),
            capacity,
            cond: Condvar::new(),
            tracer,
        }
    }

    fn put(&self, item: T) {
        let mut queue = self.queue.lock().unwrap();
        while queue.len() == self.capacity {
            emit(&self.tracer, Event::Wait);
            queue = self.cond.wait(queue).unwrap();
        }
        emit(&self.tracer, Event::Put(&item));
        queue.push_back(item);
        self.cond.notify_one(); // BUG: may wake a producer instead of a consumer
    }

    fn take(&self) -> T {
        let mut queue = self.queue.lock().unwrap();
        while queue.is_empty() {
            emit(&self.tracer, Event::Wait);
            queue = self.cond.wait(queue).unwrap();
        }
        let item = queue.pop_front().unwrap();
        emit(&self.tracer, Event::Take(&item));
        self.cond.notify_one(); // BUG: may wake a consumer instead of a producer
        item
    }
}
