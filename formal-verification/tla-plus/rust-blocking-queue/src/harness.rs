//! Runs producers and consumers against a queue with a watchdog: the shared driver of the
//! `trace` and `demo` binaries.
//!
//! A deadlocked trial cannot be cancelled: its threads sit in `Condvar::wait` forever. The
//! watchdog declares a trial stalled when no put/take has completed for a while, leaves the
//! threads blocked (they use small stacks and die with the process) and returns a
//! [`Stalled`] handle that can later confirm the stall was a real hang, not a slow thread.

use std::collections::HashMap;
use std::str::FromStr;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};
use std::{env, fmt, process};

use crate::BlockingQueue;

/// Items are the name of the producer that made them: the TLA+ spec models an item as
/// its producer's id, which lets trace validation check FIFO order.
pub type Item = Arc<str>;

/// `producers` threads named p1, p2, .. each put `items_per_producer` items; `consumers`
/// threads named c1, c2, .. take them all between them.
#[derive(Clone, Copy, Debug)]
pub struct Workload {
    pub producers: usize,
    pub consumers: usize,
    pub items_per_producer: usize,
}

impl Workload {
    pub fn producer_names(&self) -> Vec<String> {
        (1..=self.producers).map(|i| format!("p{i}")).collect()
    }

    pub fn consumer_names(&self) -> Vec<String> {
        (1..=self.consumers).map(|i| format!("c{i}")).collect()
    }

    /// How many items consumer `i` (0-based) takes: the total, split as evenly as possible.
    fn takes_for(&self, i: usize) -> usize {
        let total = self.producers * self.items_per_producer;
        total / self.consumers + usize::from(i < total % self.consumers)
    }
}

/// How a trial ended.
pub enum Outcome {
    /// Every thread returned.
    Finished,
    /// No put/take completed for the whole stall window.
    Stalled(Stalled),
}

/// A trial the watchdog gave up on. Its threads are still there.
pub struct Stalled {
    /// Threads that had not returned: the ones blocked, if this is a real hang.
    pub blocked: Vec<String>,
    progress: Arc<AtomicUsize>,
    seen: usize,
}

impl Stalled {
    /// True if any put/take completed after the watchdog fired: then it was a false alarm.
    pub fn moved_since(&self) -> bool {
        self.progress.load(Ordering::SeqCst) != self.seen
    }
}

const STACK_SIZE: usize = 128 * 1024;

/// Runs `workload` on `queue` and waits until every thread returns, or until no put/take
/// has completed for `stall`.
pub fn run(queue: Arc<dyn BlockingQueue<Item>>, workload: Workload, stall: Duration) -> Outcome {
    assert!(workload.producers > 0 && workload.consumers > 0);
    let progress = Arc::new(AtomicUsize::new(0));
    let mut threads: Vec<(String, JoinHandle<()>)> = Vec::new();

    let mut spawn = |name: String, body: Box<dyn FnOnce() + Send>| {
        let handle = thread::Builder::new()
            .name(name.clone())
            .stack_size(STACK_SIZE)
            .spawn(body)
            .expect("spawn thread");
        threads.push((name, handle));
    };

    for name in workload.producer_names() {
        let (queue, progress) = (Arc::clone(&queue), Arc::clone(&progress));
        let item: Item = Arc::from(name.as_str());
        let n = workload.items_per_producer;
        spawn(
            name,
            Box::new(move || {
                for _ in 0..n {
                    queue.put(Arc::clone(&item));
                    progress.fetch_add(1, Ordering::SeqCst);
                }
            }),
        );
    }
    for (i, name) in workload.consumer_names().into_iter().enumerate() {
        let (queue, progress) = (Arc::clone(&queue), Arc::clone(&progress));
        let n = workload.takes_for(i);
        spawn(
            name,
            Box::new(move || {
                for _ in 0..n {
                    queue.take();
                    progress.fetch_add(1, Ordering::SeqCst);
                }
            }),
        );
    }

    // Every item is put once and taken once. Once all are done the threads are merely
    // returning, and no amount of waiting makes that a stall.
    let all_ops = 2 * workload.producers * workload.items_per_producer;
    let mut seen = progress.load(Ordering::SeqCst);
    let mut last_move = Instant::now();
    loop {
        // A panicked worker counts as finished here, so join() reports the panic instead
        // of the watchdog calling it blocked.
        if threads.iter().all(|(_, handle)| handle.is_finished()) {
            for (_, handle) in threads {
                handle.join().expect("worker panicked");
            }
            return Outcome::Finished;
        }
        let now = progress.load(Ordering::SeqCst);
        if now != seen {
            seen = now;
            last_move = Instant::now();
        } else if now < all_ops && last_move.elapsed() >= stall {
            let blocked = threads
                .iter()
                .filter(|(_, handle)| !handle.is_finished())
                .map(|(name, _)| name.clone())
                .collect();
            return Outcome::Stalled(Stalled {
                blocked,
                progress,
                seen,
            });
        }
        thread::sleep(Duration::from_micros(500));
    }
}

/// Minimal `--key value` / `--switch` command-line parsing for the binaries (std only).
pub struct Flags {
    program: &'static str,
    usage: &'static str,
    values: HashMap<String, Option<String>>,
}

impl Flags {
    pub fn from_env(program: &'static str, usage: &'static str) -> Flags {
        let mut flags = Flags {
            program,
            usage,
            values: HashMap::new(),
        };
        let mut args = env::args().skip(1).peekable();
        while let Some(arg) = args.next() {
            let Some(key) = arg.strip_prefix("--") else {
                flags.fail(&format!("unexpected argument {arg:?}"));
            };
            let value = args.next_if(|v| !v.starts_with("--"));
            flags.values.insert(key.to_string(), value);
        }
        flags
    }

    /// The value of `--key`, or `default` if it is absent.
    pub fn get<T: FromStr>(&mut self, key: &str, default: T) -> T
    where
        T::Err: fmt::Display,
    {
        self.parse(key).unwrap_or(default)
    }

    /// The value of `--key`, which must be present.
    pub fn require<T: FromStr>(&mut self, key: &str) -> T
    where
        T::Err: fmt::Display,
    {
        self.parse(key)
            .unwrap_or_else(|| self.fail(&format!("--{key} is required")))
    }

    /// Whether the bare switch `--key` is present.
    pub fn switch(&mut self, key: &str) -> bool {
        self.values.remove(key).is_some()
    }

    /// Rejects any flag nobody asked for.
    pub fn finish(self) -> Self {
        if let Some(key) = self.values.keys().next() {
            self.fail(&format!("unknown flag --{key}"));
        }
        self
    }

    /// Prints `msg` and the usage, and exits with status 2.
    pub fn fail(&self, msg: &str) -> ! {
        eprintln!("{}: {msg}\n{}", self.program, self.usage);
        process::exit(2);
    }

    fn parse<T: FromStr>(&mut self, key: &str) -> Option<T>
    where
        T::Err: fmt::Display,
    {
        let value = self.values.remove(key)?;
        let value = value.unwrap_or_else(|| self.fail(&format!("--{key} needs a value")));
        match value.parse() {
            Ok(v) => Some(v),
            Err(e) => self.fail(&format!("--{key} {value}: {e}")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn consumers_split_every_item_between_them() {
        for (producers, consumers, items) in [(2, 1, 3), (2, 2, 3), (3, 2, 5), (1, 4, 3)] {
            let w = Workload {
                producers,
                consumers,
                items_per_producer: items,
            };
            let takes: Vec<usize> = (0..consumers).map(|i| w.takes_for(i)).collect();
            assert_eq!(takes.iter().sum::<usize>(), producers * items, "{w:?}");
            assert!(
                takes.iter().max().unwrap() - takes.iter().min().unwrap() <= 1,
                "{w:?}"
            );
        }
    }

    #[test]
    fn a_verified_design_finishes_under_the_watchdog() {
        let w = Workload {
            producers: 2,
            consumers: 2,
            items_per_producer: 100,
        };
        let queue = crate::Variant::Fixed.build(1, None);
        assert!(matches!(
            run(queue, w, Duration::from_secs(30)),
            Outcome::Finished
        ));
    }
}
