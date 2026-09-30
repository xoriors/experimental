//! Deterministic tests of the three queues. None of them depends on winning or losing a
//! race: blocking is observed through the Tracer (a thread reports `Event::Wait` while it
//! still holds the lock, just before it sleeps), and the concurrent tests check only what
//! every interleaving must produce. Note what is NOT here: a test that makes the buggy queue
//! hang. That needs more threads than 2 x capacity and a lucky schedule; see `make demo`
//! and the TLA+ models instead.

use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use blocking_queue::trace::{Op, Record, Recorder};
use blocking_queue::{BlockingQueue, Buggy, Event, Fixed, Tracer, Variant};

/// Generous upper bound for things that must happen; only reached if the code is broken.
const PATIENCE: Duration = Duration::from_secs(30);

/// Sends the name of every thread that is about to wait.
struct WaitSignal(Mutex<Sender<String>>);

impl<T> Tracer<T> for WaitSignal {
    fn event(&self, event: Event<'_, T>) {
        if let Event::Wait = event {
            let name = thread::current().name().unwrap_or("?").to_owned();
            self.0.lock().unwrap().send(name).unwrap();
        }
    }
}

fn with_wait_signal<T: Send + 'static>(
    variant: Variant,
    capacity: usize,
) -> (Arc<dyn BlockingQueue<T>>, mpsc::Receiver<String>) {
    let (tx, rx) = mpsc::channel();
    let queue = variant.build(capacity, Some(Box::new(WaitSignal(Mutex::new(tx)))));
    (queue, rx)
}

fn spawn_named<F: FnOnce() -> R + Send + 'static, R: Send + 'static>(
    name: &str,
    f: F,
) -> thread::JoinHandle<R> {
    thread::Builder::new().name(name.into()).spawn(f).unwrap()
}

/// Runs `f` on another thread and fails the test if it does not finish in time (a hang).
fn finishes<R: Send + 'static>(what: &str, f: impl FnOnce() -> R + Send + 'static) -> R {
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || tx.send(f()).unwrap());
    rx.recv_timeout(PATIENCE)
        .unwrap_or_else(|_| panic!("{what}: still running after {PATIENCE:?}"))
}

#[test]
fn fifo_order() {
    for variant in Variant::ALL {
        let q = variant.build::<u32>(3, None);
        for i in 1..=3 {
            q.put(i);
        }
        assert_eq!([q.take(), q.take(), q.take()], [1, 2, 3], "{variant}");
    }
}

#[test]
fn put_blocks_while_full_until_a_take_makes_room() {
    for variant in Variant::ALL {
        let (q, waits) = with_wait_signal::<u32>(variant, 1);
        q.put(1);
        let q2 = Arc::clone(&q);
        let producer = spawn_named("producer", move || q2.put(2));
        // The producer found the queue full; it holds the lock until wait() releases it,
        // so our take() below cannot run before the producer is really waiting.
        assert_eq!(
            waits.recv_timeout(PATIENCE).unwrap(),
            "producer",
            "{variant}"
        );
        assert_eq!(q.take(), 1, "{variant}");
        producer.join().unwrap(); // the take's notification woke it and its put completed
        assert_eq!(q.take(), 2, "{variant}");
    }
}

#[test]
fn take_blocks_while_empty_until_a_put() {
    for variant in Variant::ALL {
        let (q, waits) = with_wait_signal::<u32>(variant, 1);
        let q2 = Arc::clone(&q);
        let consumer = spawn_named("consumer", move || q2.take());
        assert_eq!(
            waits.recv_timeout(PATIENCE).unwrap(),
            "consumer",
            "{variant}"
        );
        q.put(7);
        assert_eq!(consumer.join().unwrap(), 7, "{variant}");
    }
}

/// Many producers and consumers through a tiny queue. Every item must arrive exactly once,
/// and each consumer must see each producer's items in the order they were put (FIFO).
fn deliver_everything(variant: Variant, producers: usize, consumers: usize, capacity: usize) {
    const ITEMS: usize = 2_000;
    let received = finishes(
        &format!("{variant} P{producers} C{consumers} K{capacity}"),
        move || {
            let q = variant.build::<(usize, usize)>(capacity, None);
            let total = producers * ITEMS;
            let putters: Vec<_> = (0..producers)
                .map(|p| {
                    let q = Arc::clone(&q);
                    thread::spawn(move || (0..ITEMS).for_each(|i| q.put((p, i))))
                })
                .collect();
            let takers: Vec<_> = (0..consumers)
                .map(|c| {
                    let q = Arc::clone(&q);
                    let n = total / consumers + usize::from(c < total % consumers);
                    thread::spawn(move || (0..n).map(|_| q.take()).collect::<Vec<_>>())
                })
                .collect();
            putters.into_iter().for_each(|t| t.join().unwrap());
            takers
                .into_iter()
                .map(|t| t.join().unwrap())
                .collect::<Vec<_>>()
        },
    );

    for (c, items) in received.iter().enumerate() {
        for p in 0..producers {
            let seq: Vec<usize> = items
                .iter()
                .filter(|(q, _)| *q == p)
                .map(|&(_, i)| i)
                .collect();
            assert!(
                seq.windows(2).all(|w| w[0] < w[1]),
                "{variant}: c{c} saw p{p} out of order"
            );
        }
    }
    let mut all: Vec<_> = received.into_iter().flatten().collect();
    all.sort_unstable();
    let expected: Vec<_> = (0..producers)
        .flat_map(|p| (0..ITEMS).map(move |i| (p, i)))
        .collect();
    assert_eq!(all, expected, "{variant}: lost or duplicated items");
}

#[test]
fn verified_designs_deliver_every_item_exactly_once() {
    // The configurations where TLC finds the buggy design deadlocking.
    for variant in [Variant::Fixed, Variant::NotifyAll] {
        deliver_everything(variant, 2, 1, 1);
        deliver_everything(variant, 1, 2, 1);
        deliver_everything(variant, 4, 3, 3);
        deliver_everything(variant, 4, 4, 2);
    }
}

#[test]
fn the_buggy_queue_passes_the_usual_one_producer_one_consumer_test() {
    // TLC (spec/Buggy_P1C1K1.cfg, and the sweep in the README): with two threads the buggy
    // design cannot deadlock at any capacity checked. This is the test everybody writes,
    // and it is green.
    deliver_everything(Variant::Buggy, 1, 1, 1);
    deliver_everything(Variant::Buggy, 1, 1, 4);
}

#[test]
fn recorder_logs_one_event_per_critical_section_in_lock_order() {
    let recorder = Recorder::new();
    let q = Arc::new(Fixed::<&str>::with_tracer(
        1,
        Some(Box::new(recorder.clone())),
    ));
    let q2 = Arc::clone(&q);
    spawn_named("p1", move || {
        q2.put("x");
        assert_eq!(q2.take(), "x");
    })
    .join()
    .unwrap();

    // A consumer that must wait: its Wait is logged before our put, because it held the lock.
    let (tx, rx) = mpsc::channel();
    let q = Arc::new(Fixed::<&str>::with_tracer(
        1,
        Some(Box::new(Tee(recorder.clone(), WaitSignal(Mutex::new(tx))))),
    ));
    let q2 = Arc::clone(&q);
    let consumer = spawn_named("c1", move || q2.take());
    assert_eq!(rx.recv_timeout(PATIENCE).unwrap(), "c1");
    spawn_named("p1", move || q.put("y")).join().unwrap();
    assert_eq!(consumer.join().unwrap(), "y");

    let rec = |thread: &str, op, item: Option<&str>| Record {
        thread: thread.into(),
        op,
        item: item.map(Into::into),
    };
    assert_eq!(
        recorder.snapshot(),
        [
            rec("p1", Op::Put, Some("x")),
            rec("p1", Op::Take, Some("x")),
            rec("c1", Op::Wait, None),
            rec("p1", Op::Put, Some("y")),
            rec("c1", Op::Take, Some("y")),
        ]
    );
}

/// Two tracers at once.
struct Tee<A, B>(A, B);

impl<T, A: Tracer<T>, B: Tracer<T>> Tracer<T> for Tee<A, B> {
    fn event(&self, event: Event<'_, T>) {
        self.0.event(event);
        self.1.event(event);
    }
}

#[test]
#[should_panic(expected = "capacity must be at least 1")]
fn zero_capacity_is_rejected() {
    let _ = Buggy::<u8>::new(0);
}
