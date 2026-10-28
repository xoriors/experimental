//! hutter-lab: measure Hutter Prize ideas on enwik9.
//!
//! ```text
//! hutter-lab streams <enwik9> [--order FILE] [--out DIR]
//! hutter-lab header  <enwik9> [--order FILE] [--verify]
//! hutter-lab lang    <enwik9> [--order FILE] [--verify]
//! hutter-lab census  <enwik9> [--verify]
//! hutter-lab bench   <file> [bytes] [table_bits]
//! ```
//!
//! `--order` takes `src/readalike_prepr/data/new_article_order` from the
//! fx2-cmix-T repository, so the streams match the record holder's layout.

use std::time::Instant;

use hutter_lab::cm::{Config, Model};
use hutter_lab::coder;
use hutter_lab::enwik::{self, Page, Streams};
use hutter_lab::report::{self, Labels};
use hutter_lab::side::SideModel;
use hutter_lab::side::census::{self, CensusModel};
use hutter_lab::side::header::HeaderModel;
use hutter_lab::side::lang::LangModel;
use hutter_lab::transform;

struct Args {
    cmd: String,
    input: String,
    order: Option<String>,
    out: Option<String>,
    verify: bool,
    table_bits: u32,
    rest: Vec<String>,
}

fn parse_args() -> Args {
    let mut it = std::env::args().skip(1);
    let cmd = it.next().unwrap_or_else(|| usage());
    let mut a = Args {
        cmd,
        input: String::new(),
        order: None,
        out: None,
        verify: false,
        table_bits: 20,
        rest: vec![],
    };
    while let Some(x) = it.next() {
        match x.as_str() {
            "--order" => a.order = it.next(),
            "--out" => a.out = it.next(),
            "--verify" => a.verify = true,
            "--table-bits" => {
                a.table_bits = it
                    .next()
                    .and_then(|v| v.parse().ok())
                    .unwrap_or_else(|| usage())
            }
            _ if a.input.is_empty() => a.input = x,
            _ => a.rest.push(x),
        }
    }
    if a.input.is_empty() {
        usage();
    }
    a
}

fn usage() -> ! {
    eprintln!(
        "usage: hutter-lab <streams|header|lang|census|bench> <input> [--order FILE] [--out DIR] [--verify] [--table-bits N]"
    );
    std::process::exit(2)
}

fn main() {
    let a = parse_args();
    let data = std::fs::read(&a.input).unwrap_or_else(|e| {
        eprintln!("cannot read {}: {e}", a.input);
        std::process::exit(1)
    });
    let cfg = Config {
        table_bits: a.table_bits,
    };
    match a.cmd.as_str() {
        "bench" => bench(&data, &a),
        "streams" => {
            let (pages, s) = layout(&data, &a);
            print_stream_stats(&data, &pages, &s);
            if let Some(dir) = &a.out {
                std::fs::create_dir_all(dir).unwrap();
                for (name, bytes) in [("main", &s.main), ("header", &s.header), ("lang", &s.lang)] {
                    std::fs::write(format!("{dir}/{name}"), bytes).unwrap();
                }
            }
        }
        "header" => {
            let (_, s) = layout(&data, &a);
            let labels = header_labels(&s.header);
            experiment(
                "Header stream: revision ids and timestamps as a global clock",
                &s.header,
                &labels,
                cfg,
                a.verify,
                &|| Box::new(HeaderModel::new()),
            );
            let fwd = transform::header_forward(&s.header);
            let ok = transform::header_inverse(&fwd) == s.header;
            transform_experiment("header residual transform", &s.header, &fwd, ok, cfg);
        }
        "lang" => {
            let (pages, s) = layout(&data, &a);
            let titles: Vec<Vec<u8>> = s
                .lang_pages
                .iter()
                .map(|&p| enwik::title(&data, &pages[p]).to_vec())
                .collect();
            let labels = lang_labels(&s.lang, &titles);
            experiment(
                "Interwiki stream: links name the article's own subject",
                &s.lang,
                &labels,
                cfg,
                a.verify,
                &|| Box::new(LangModel::new(titles.clone())),
            );
            let fwd = transform::lang_forward(&s.lang, &titles);
            let ok = transform::lang_inverse(&fwd, &titles) == s.lang;
            transform_experiment("interwiki title-escape transform", &s.lang, &fwd, ok, cfg);
        }
        "census" => {
            let pages = enwik::pages(&data);
            let mut text = Vec::new();
            for p in pages
                .iter()
                .filter(|p| census::is_census_page(&data[p.span.clone()]))
            {
                text.extend_from_slice(&data[p.span.clone()]);
            }
            let labels = census::labels(&text);
            experiment(
                "Census articles: unit conversions and densities are arithmetic",
                &text,
                &labels,
                cfg,
                a.verify,
                &|| Box::new(CensusModel::new()),
            );
        }
        _ => usage(),
    }
}

fn layout(data: &[u8], a: &Args) -> (Vec<Page>, Streams) {
    let t = Instant::now();
    let pages = enwik::pages(data);
    let order_file = a
        .order
        .as_ref()
        .map(|f| std::fs::read(f).expect("read order file"));
    let order = enwik::order(&pages, order_file.as_deref());
    let s = enwik::split(data, &pages, &order);
    eprintln!(
        "{} pages ({} redirects), order: {}, split in {:.1}s",
        pages.len(),
        pages.iter().filter(|p| p.redirect).count(),
        if a.order.is_some() {
            "record holder's"
        } else {
            "file"
        },
        t.elapsed().as_secs_f64()
    );
    (pages, s)
}

fn experiment(
    title: &str,
    stream: &[u8],
    labels: &Labels,
    cfg: Config,
    verify: bool,
    make: &(dyn Fn() -> Box<dyn SideModel> + Sync),
) {
    let (base, with) = report::compare(stream, labels, cfg, make);
    report::print_comparison(title, stream.len(), labels, &base, &with);
    if verify {
        let t = Instant::now();
        let (packed, ok) = report::round_trip(stream, cfg, make);
        println!(
            "\nround trip with the side model: {} -> {} bytes, decoded output {} ({:.1}s)",
            stream.len(),
            packed,
            if ok { "identical" } else { "DIFFERENT" },
            t.elapsed().as_secs_f64()
        );
        if !ok {
            std::process::exit(1);
        }
    }
}

/// The plain model on the original and on the transformed stream.
fn transform_experiment(
    name: &str,
    original: &[u8],
    transformed: &[u8],
    round_trip_ok: bool,
    cfg: Config,
) {
    let (before, after) = std::thread::scope(|sc| {
        let b = sc.spawn(|| coder::measure(original, &mut Model::new(cfg, None), None));
        let a = sc.spawn(|| coder::measure(transformed, &mut Model::new(cfg, None), None));
        (b.join().unwrap(), a.join().unwrap())
    });
    println!("\n### {name}\n");
    println!(
        "inverse(forward(stream)) == stream: {}",
        if round_trip_ok { "yes" } else { "NO" }
    );
    println!(
        "plain model: {:.0} bytes on the original ({} bytes), {:.0} bytes on the transformed stream ({} bytes): saved {:.0} bytes",
        before / 8.0,
        original.len(),
        after / 8.0,
        transformed.len(),
        (before - after) / 8.0
    );
    if !round_trip_ok {
        std::process::exit(1);
    }
}

fn bench(data: &[u8], a: &Args) {
    let n: usize = a
        .rest
        .first()
        .and_then(|s| s.parse().ok())
        .unwrap_or(data.len())
        .min(data.len());
    let tb: u32 = a.rest.get(1).and_then(|s| s.parse().ok()).unwrap_or(20);
    let t = Instant::now();
    let mut m = Model::new(Config { table_bits: tb }, None);
    let bits = coder::measure(&data[..n], &mut m, None);
    let secs = t.elapsed().as_secs_f64();
    println!(
        "{} bytes -> {:.0} bytes ({:.4} bpc) in {:.1}s ({:.2} MB/s)",
        n,
        bits / 8.0,
        bits / n as f64,
        secs,
        n as f64 / secs / 1e6
    );
}

fn print_stream_stats(data: &[u8], pages: &[Page], s: &Streams) {
    println!("pages: {}", pages.len());
    println!("redirects: {}", pages.iter().filter(|p| p.redirect).count());
    println!("main stream: {} bytes", s.main.len());
    println!("header stream: {} bytes", s.header.len());
    println!(
        "lang stream: {} bytes in {} blocks",
        s.lang.len(),
        s.lang_pages.len()
    );
    let covered: usize = pages.iter().map(|p| p.span.len()).sum();
    println!("bytes outside complete pages: {}", data.len() - covered);
}

/// Labels for the header stream, by line kind. Timestamps are split into the
/// date ("YY" + day index + ":") and the second of day, because a transformer
/// can plausibly learn the date from the revision id on the line above but
/// not the second, which needs interpolation between other pages.
fn header_labels(h: &[u8]) -> Labels {
    let names = [
        "page id delta",
        "revision id, pre-migration (< 17M)",
        "revision id, post-migration",
        "timestamp, pre-migration page",
        "timestamp date, post-migration page",
        "timestamp seconds, post-migration page",
        "username / ip",
        "user id",
        "tags and other lines",
    ];
    let mut of = vec![8u8; h.len()];
    let mut pos = 0;
    let mut after_revision = false;
    let mut rev_pre = false;
    while pos < h.len() {
        let end = pos
            + h[pos..]
                .iter()
                .position(|&c| c == b'\n')
                .map_or(h.len() - pos, |i| i + 1);
        let line = &h[pos..end];
        if line.starts_with(b">") {
            of[pos..end].fill(0);
        } else if after_revision && line.starts_with(b"id>") {
            let v: i64 = std::str::from_utf8(&line[3..line.len() - 1])
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(0);
            rev_pre = v < 17_000_000;
            of[pos..end].fill(if rev_pre { 1 } else { 2 });
        } else if line.starts_with(b"timestamp>") {
            if rev_pre {
                of[pos..end].fill(3);
            } else {
                let colon = line
                    .iter()
                    .position(|&c| c == b':')
                    .unwrap_or(line.len() - 1);
                of[pos..pos + colon + 1].fill(4);
                of[pos + colon + 1..end].fill(5);
            }
        } else if line.starts_with(b"username>") || line.starts_with(b"ip>") {
            of[pos..end].fill(6);
        } else if line.starts_with(b"id>") {
            of[pos..end].fill(7);
        }
        after_revision = line == b"revision>\n";
        pos = end;
    }
    Labels {
        names: names.iter().map(|s| s.to_string()).collect(),
        of,
    }
}

/// Labels for the lang stream. The first title of a block is where the
/// record holder pays full price (the article's title is far away in the main
/// stream); later titles can be copied from the block itself, which a
/// transformer does well, so their savings transfer less.
fn lang_labels(lang: &[u8], titles: &[Vec<u8>]) -> Labels {
    let names = [
        "[[code: and ]]",
        "first title in block, = English title",
        "first title in block, other",
        "later titles, = English title",
        "later titles, other",
        "other lines",
    ];
    let mut of = vec![5u8; lang.len()];
    let mut pos = 0;
    let mut block = 0usize;
    let mut first = true;
    while pos < lang.len() {
        let end = pos
            + lang[pos..]
                .iter()
                .position(|&c| c == b'\n')
                .map_or(lang.len() - pos, |i| i + 1);
        let line = &lang[pos..end];
        if line.starts_with(b"[[")
            && let (Some(colon), Some(close)) = (
                line.iter().position(|&c| c == b':'),
                enwik::find(line, b"]]"),
            )
            && colon < close
        {
            let t = &line[colon + 1..close];
            let eq = titles.get(block).is_some_and(|x| x.as_slice() == t);
            let l = match (first, eq) {
                (true, true) => 1,
                (true, false) => 2,
                (false, true) => 3,
                (false, false) => 4,
            };
            first = false;
            of[pos..pos + colon + 1].fill(0);
            of[pos + colon + 1..pos + close].fill(l);
            of[pos + close..pos + (close + 2).min(line.len())].fill(0);
        }
        if enwik::find(line, b"</text>").is_some() {
            block += 1;
            first = true;
        }
        pos = end;
    }
    Labels {
        names: names.iter().map(|s| s.to_string()).collect(),
        of,
    }
}
