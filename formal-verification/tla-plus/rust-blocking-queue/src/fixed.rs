//! FIXED: two Condvars. Producers wait on `not_full`, consumers on `not_empty`, and each
//! side `notify_one`s the Condvar the *other* side waits on, so every wakeup reaches a
//! thread that can use it. TLC finds no deadlock, with or without spurious wakeups; see
//! spec/BlockingQueueFixed.tla. Diff this file against buggy.rs.

use std::collections::VecDeque;
use std::sync::{Condvar, Mutex};

use crate::{BlockingQueue, Event, Tracer, emit};

pub struct Fixed<T> {
    queue: Mutex<VecDeque<T>>,
    capacity: usize,
    not_full: Condvar,  // producers wait here; consumers notify it
    not_empty: Condvar, // consumers wait here; producers notify it
    tracer: Option<Box<dyn Tracer<T>>>,
}

impl<T: Send> BlockingQueue<T> for Fixed<T> {
    fn with_tracer(capacity: usize, tracer: Option<Box<dyn Tracer<T>>>) -> Self {
        assert!(capacity > 0, "capacity must be at least 1");
        Fixed {
            queue: Mutex::new(VecDeque::with_capacity(capacity)),
            capacity,
            not_full: Condvar::new(),
            not_empty: Condvar::new(),
            tracer,
        }
    }

    fn put(&self, item: T) {
        let mut queue = self.queue.lock().unwrap();
        while queue.len() == self.capacity {
            emit(&self.tracer, Event::Wait);
            queue = self.not_full.wait(queue).unwrap();
        }
        emit(&self.tracer, Event::Put(&item));
        queue.push_back(item);
        self.not_empty.notify_one(); // only consumers wait on not_empty
    }

    fn take(&self) -> T {
        let mut queue = self.queue.lock().unwrap();
        while queue.is_empty() {
            emit(&self.tracer, Event::Wait);
            queue = self.not_empty.wait(queue).unwrap();
        }
        let item = queue.pop_front().unwrap();
        emit(&self.tracer, Event::Take(&item));
        self.not_full.notify_one(); // only producers wait on not_full
        item
    }
}
