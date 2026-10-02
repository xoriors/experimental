//! Stress demo: many short trials of each design under a watchdog, counting how often the
//! real program hangs. No tracer is installed: this is the plain, uninstrumented queue.
//!
//! ```text
//! demo [--trials 2000] [--producers 2] [--consumers 1] [--capacity 1] [--items 200]
//!      [--stall-ms 100] [--variants buggy,fixed,notify_all]
//! ```
//!
//! A trial counts as hung when no put/take completes for the stall window. Hung threads
//! cannot be cancelled, so they are left blocked; at the end every hung trial is checked
//! again, and any that moved in the meantime is reported as a false alarm. Exits non-zero if
//! a design that TLC verified (fixed, notify_all) hangs for real.

use std::process;
use std::thread;
use std::time::{Duration, Instant};

use blocking_queue::Variant;
use blocking_queue::harness::{self, Flags, Outcome, Stalled, Workload};

const USAGE: &str = "usage: demo [--trials N] [--producers N] [--consumers N] [--capacity N] \
[--items N] [--stall-ms MS] [--variants buggy,fixed,notify_all]";

fn main() {
    let mut flags = Flags::from_env("demo", USAGE);
    let trials: usize = flags.get("trials", 2000);
    let workload = Workload {
        producers: flags.get("producers", 2),
        consumers: flags.get("consumers", 1),
        items_per_producer: flags.get("items", 200),
    };
    let capacity: usize = flags.get("capacity", 1);
    let stall = Duration::from_millis(flags.get("stall-ms", 100));
    let variants: String = flags.get("variants", "buggy,fixed,notify_all".to_string());
    let flags = flags.finish();
    let variants: Vec<Variant> = variants
        .split(',')
        .map(|v| v.parse().unwrap_or_else(|e: String| flags.fail(&e)))
        .collect();

    let threads = workload.producers + workload.consumers;
    println!(
        "{trials} trials per design, each {} producer(s) x {} items -> {} consumer(s), capacity {capacity}",
        workload.producers, workload.items_per_producer, workload.consumers
    );
    // The rule comes from the TLC sweep in the README (capacity 1..4, up to 9 threads).
    println!(
        "threads = {threads}, 2 x capacity = {}: {}",
        2 * capacity,
        if threads > 2 * capacity {
            "TLC finds a deadlock of the buggy design in every such configuration it checked"
        } else {
            "TLC finds no deadlock of the buggy design in any such configuration it checked"
        }
    );
    println!(
        "a trial is hung when no put/take completes for {} ms\n",
        stall.as_millis()
    );

    let mut hung: Vec<(Variant, Stalled)> = Vec::new();
    for &variant in &variants {
        let start = Instant::now();
        let (mut count, mut first) = (0, None);
        for trial in 1..=trials {
            if let Outcome::Stalled(stalled) =
                harness::run(variant.build(capacity, None), workload, stall)
            {
                count += 1;
                first.get_or_insert(trial);
                hung.push((variant, stalled));
            }
        }
        let secs = start.elapsed().as_secs_f64();
        let first = first.map_or("-".to_string(), |t| format!("trial {t}"));
        println!(
            "{:<11} hung {count:>5} / {trials} ({:>5.1}%)   first hang: {first:<12} {secs:>6.1} s",
            variant.name(),
            100.0 * count as f64 / trials as f64,
        );
    }

    // A real deadlock never moves again; a slow trial would have finished by now.
    thread::sleep(Duration::from_secs(1));
    let false_alarms = hung.iter().filter(|(_, s)| s.moved_since()).count();
    println!(
        "\nre-checked all {} hung trials 1 s later: {} still stuck, {false_alarms} false alarm(s)",
        hung.len(),
        hung.len() - false_alarms
    );
    let verified_hung = hung
        .iter()
        .filter(|(v, s)| *v != Variant::Buggy && !s.moved_since())
        .count();
    if verified_hung > 0 {
        eprintln!("demo: {verified_hung} hang(s) of a design TLC verified as deadlock-free!");
        process::exit(1);
    }
}
