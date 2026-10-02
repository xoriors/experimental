//! NOTIFY_ALL: the buggy variant's single Condvar, but every put and take wakes *all*
//! waiters. Whoever needed the wakeup is among them, so none is lost; the price is that
//! every other waiter wakes up only to re-test its condition and sleep again. TLC finds no
//! deadlock; see spec/BlockingQueueNotifyAll.tla. Diff this file against buggy.rs.

use std::collections::VecDeque;
use std::sync::{Condvar, Mutex};

use crate::{BlockingQueue, Event, Tracer, emit};

pub struct NotifyAll<T> {
    queue: Mutex<VecDeque<T>>,
    capacity: usize,
    cond: Condvar, // "the queue changed": producers AND consumers wait here
    tracer: Option<Box<dyn Tracer<T>>>,
}

impl<T: Send> BlockingQueue<T> for NotifyAll<T> {
    fn with_tracer(capacity: usize, tracer: Option<Box<dyn Tracer<T>>>) -> Self {
        assert!(capacity > 0, "capacity must be at least 1");
        NotifyAll {
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
        self.cond.notify_all(); // the consumers that need this are among those woken
    }

    fn take(&self) -> T {
        let mut queue = self.queue.lock().unwrap();
        while queue.is_empty() {
            emit(&self.tracer, Event::Wait);
            queue = self.cond.wait(queue).unwrap();
        }
        let item = queue.pop_front().unwrap();
        emit(&self.tracer, Event::Take(&item));
        self.cond.notify_all(); // the producers that need this are among those woken
        item
    }
}
