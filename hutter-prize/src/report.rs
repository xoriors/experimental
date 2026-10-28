//! Runs a stream through the model with and without a side model, attributes
//! the coded bits to labelled regions, and optionally proves the gain with a
//! real encode/decode round trip.

use std::time::Instant;

use crate::cm::{Config, Model};
use crate::coder;
use crate::side::SideModel;

/// One label per byte of a stream, and the labels' names.
pub struct Labels {
    pub names: Vec<String>,
    pub of: Vec<u8>,
}

pub struct Run {
    pub bits: f64,
    pub per_label: Vec<f64>,
    pub secs: f64,
}

pub fn run(data: &[u8], labels: &Labels, cfg: Config, side: Option<Box<dyn SideModel>>) -> Run {
    let t = Instant::now();
    let mut m = Model::new(cfg, side);
    let mut cost = Vec::with_capacity(data.len());
    let bits = coder::measure(data, &mut m, Some(&mut cost));
    let mut per_label = vec![0.0; labels.names.len()];
    for (c, &l) in cost.iter().zip(&labels.of) {
        per_label[l as usize] += *c as f64;
    }
    Run {
        bits,
        per_label,
        secs: t.elapsed().as_secs_f64(),
    }
}

/// Measures the stream without and with the side model, in parallel.
pub fn compare(
    data: &[u8],
    labels: &Labels,
    cfg: Config,
    make_side: &(dyn Fn() -> Box<dyn SideModel> + Sync),
) -> (Run, Run) {
    std::thread::scope(|s| {
        let base = s.spawn(|| run(data, labels, cfg, None));
        let with = s.spawn(|| run(data, labels, cfg, Some(make_side())));
        (base.join().unwrap(), with.join().unwrap())
    })
}

/// Encodes with the side model, decodes with a fresh one, and checks the
/// output. Returns the compressed size and whether the round trip matched.
pub fn round_trip(
    data: &[u8],
    cfg: Config,
    make_side: &(dyn Fn() -> Box<dyn SideModel> + Sync),
) -> (usize, bool) {
    let mut enc_model = Model::new(cfg, Some(make_side()));
    let packed = coder::encode(data, &mut enc_model);
    drop(enc_model);
    let mut dec_model = Model::new(cfg, Some(make_side()));
    let out = coder::decode(&packed, data.len(), &mut dec_model);
    (packed.len(), out == data)
}

pub fn print_comparison(title: &str, data_len: usize, labels: &Labels, base: &Run, with: &Run) {
    let lbytes: Vec<usize> = (0..labels.names.len())
        .map(|k| labels.of.iter().filter(|&&l| l as usize == k).count())
        .collect();
    println!("\n## {title}\n");
    println!("stream: {} bytes", data_len);
    println!(
        "base model: {:.0} bytes ({:.4} bpc, {:.1}s) | with side model: {:.0} bytes ({:.4} bpc, {:.1}s)",
        base.bits / 8.0,
        base.bits / data_len as f64,
        base.secs,
        with.bits / 8.0,
        with.bits / data_len as f64,
        with.secs
    );
    println!(
        "saved: {:.0} bytes ({:.2}% of this stream)\n",
        (base.bits - with.bits) / 8.0,
        100.0 * (base.bits - with.bits) / base.bits
    );
    println!("| region | raw bytes | base: bytes | with side model: bytes | saved bytes |");
    println!("|---|---:|---:|---:|---:|");
    for (k, &n) in lbytes.iter().enumerate() {
        if n == 0 {
            continue;
        }
        println!(
            "| {} | {} | {:.0} | {:.0} | {:.0} |",
            labels.names[k],
            n,
            base.per_label[k] / 8.0,
            with.per_label[k] / 8.0,
            (base.per_label[k] - with.per_label[k]) / 8.0
        );
    }
}
