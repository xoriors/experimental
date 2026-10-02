//! Records a real run of one queue design and writes the log out as a TLA+ module plus
//! the TLC models that check it against the design's spec (trace validation).
//!
//! ```text
//! trace --variant fixed --producers 2 --consumers 2 --capacity 1 --items 4 \
//!       --out target/traces --name TraceRunFixed
//! trace --variant buggy --producers 2 --consumers 1 --capacity 1 --items 30 \
//!       --until-hang --trials 20000 --out target/traces --name TraceRunBuggyHang
//! ```
//!
//! Writes `<out>/<name>.tla` (the log), `<out>/<name>.cfg` (expected: accepted by the
//! design's spec, spurious wakeups allowed) and `<out>/<name>NoSpurious.cfg`
//! (informational: can the run be explained without any spurious wakeup?). With
//! `--until-hang` it keeps running fresh trials until one hangs, and exits with status 1 if
//! none of the `--trials` does.

use std::fs;
use std::path::PathBuf;
use std::process;
use std::time::Duration;

use blocking_queue::Variant;
use blocking_queue::harness::{self, Flags, Item, Outcome, Workload};
use blocking_queue::trace::{Op, Recorder, TraceModule, Tracer, fifo_tests};

const USAGE: &str = "usage: trace --variant buggy|fixed|notify_all --out DIR --name MODULE \
[--producers N] [--consumers N] [--capacity N] [--items N] [--stall-ms MS] \
[--until-hang] [--trials N]";

fn main() {
    let mut flags = Flags::from_env("trace", USAGE);
    let variant: Variant = flags.require("variant");
    let out: PathBuf = flags.require("out");
    let name: String = flags.require("name");
    let workload = Workload {
        producers: flags.get("producers", 2),
        consumers: flags.get("consumers", 2),
        items_per_producer: flags.get("items", 4),
    };
    let capacity: usize = flags.get("capacity", 1);
    let stall = Duration::from_millis(flags.get("stall-ms", 200));
    let until_hang = flags.switch("until-hang");
    let trials: usize = flags.get("trials", 1);
    let flags = flags.finish();

    // Run trials until one fits: the first, or with --until-hang the first that hangs.
    let mut trial = 0;
    let (records, blocked) = loop {
        trial += 1;
        let recorder = Recorder::new();
        let tracer: Box<dyn Tracer<Item>> = Box::new(recorder.clone());
        let queue = variant.build(capacity, Some(tracer));
        match harness::run(queue, workload, stall) {
            Outcome::Stalled(stalled) => {
                // Give a slow-but-alive run the chance to show itself before calling it a hang.
                std::thread::sleep(stall);
                if stalled.moved_since() {
                    flags.fail(
                        "the watchdog fired on a run that was still moving; raise --stall-ms",
                    );
                }
                break (recorder.snapshot(), stalled.blocked);
            }
            Outcome::Finished if until_hang && trial < trials => continue,
            Outcome::Finished if until_hang => {
                eprintln!("trace: --until-hang: none of the {trials} trial(s) hung");
                process::exit(1);
            }
            Outcome::Finished => break (recorder.snapshot(), Vec::new()),
        }
    };

    let ended = if blocked.is_empty() {
        "every thread returned".to_string()
    } else {
        format!("HUNG, blocked for good: {}", blocked.join(", "))
    };
    let waits = records.iter().filter(|r| r.op == Op::Wait).count();
    let fifo = fifo_tests(&records);
    let provenance = format!(
        "A real run of src/{}.rs: {} producer(s) x {} item(s), {} consumer(s), capacity {}.\n\
         Trial {trial} of `trace{}`: {ended}. {} records, {waits} of them waits.\n\
         Takes that test FIFO order (items of 2+ producers queued): {fifo}.",
        variant.name(),
        workload.producers,
        workload.items_per_producer,
        workload.consumers,
        capacity,
        if until_hang { " --until-hang" } else { "" },
        records.len(),
    );
    let module = TraceModule {
        name: &name,
        variant,
        producers: &workload.producer_names(),
        consumers: &workload.consumer_names(),
        capacity,
        blocked: &blocked,
        records: &records,
        provenance: &provenance,
    };

    fs::create_dir_all(&out).expect("create the --out directory");
    let write = |file: String, text: String| {
        let path = out.join(file);
        fs::write(&path, text).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    };
    write(format!("{name}.tla"), module.tla());
    write(format!("{name}.cfg"), module.cfg(variant, true, true));
    write(
        format!("{name}NoSpurious.cfg"),
        module.cfg(variant, false, false),
    );
    println!(
        "{}/{name}.tla\n  {}",
        out.display(),
        provenance.replace('\n', "\n  ")
    );
}
