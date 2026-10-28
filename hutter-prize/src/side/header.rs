//! Header side model: revision ids and timestamps read as a global clock.
//!
//! It runs over the PHDA9 header stream, where every page contributes
//!
//! ```text
//! >{page id minus previous page id}
//! revision>
//! id>{revision id}
//! timestamp>{year-2001, 2 digits}{(month-1)*31 + day-1}:{second of day}
//! contributor> ... /contributor>
//! ```
//!
//! Two facts about how MediaWiki numbered revisions carry most of the
//! information in these fields:
//!
//! * The MediaWiki 1.5 migration (June 2005) renumbered every page's then
//!   current revision in page-id order. For a page whose latest revision is
//!   older than that (revision id below 17,000,000; 36% of pages), the
//!   revision id is a strictly increasing function of the page id, so it can
//!   be interpolated from pages already seen.
//! * After the migration, revision ids count edits across the whole wiki, so
//!   the timestamp is a monotone function of the revision id: interpolating
//!   between the nearest pages seen so far gets within 1.5 s (median).
//!
//! The page id comes from summing the deltas, which the decoder has too.

use std::collections::BTreeMap;

use super::numfmt::{days_from_civil, days_in_month, decimal_next, laplace_mass, to_dist};
use super::{ByteDist, SideModel};

/// First revision id assigned after the 1.5 migration, rounded down.
const MIGRATION_REV: i64 = 17_000_000;
const POST_BIN_SHIFT: u32 = 17;
const POST_BINS: usize = 256;
const MAX_REV: i64 = 999_999_999;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Field {
    None,
    RevId,
    Timestamp,
}

pub struct HeaderModel {
    line: Vec<u8>,
    field: Field,
    expect_rev: bool,
    pid: i64,
    rev: Option<i64>,
    /// Pre-migration pages: page id -> revision id.
    pre: BTreeMap<i64, i64>,
    /// Post-migration pages: revision id -> timestamp.
    post: BTreeMap<i64, i64>,
    post_bins: [f64; POST_BINS],
    post_cdf: [f64; POST_BINS + 1],
    post_dirty: bool,
    pre_bucket: Vec<[u32; 2]>,
    pre_recent: f64,
    pre_scale: f64,
    ts_scale: f64,
    // Prediction for the field being typed.
    rev_pred: RevPred,
    ts_pred: Option<TsPred>,
    dist: ByteDist,
    active: bool,
    pub stats: HeaderStats,
}

#[derive(Default, Clone, Debug)]
pub struct HeaderStats {
    pub pages: u64,
    pub pre_pages: u64,
    pub post_pages: u64,
    pub ts_predicted: u64,
}

#[derive(Clone, Copy, Default)]
struct RevPred {
    w_pre: f64,
    pre: Option<(f64, f64, i64, i64)>, // mu, scale, lo, hi
}

#[derive(Clone, Copy)]
struct TsPred {
    mu: f64,
    s: f64,
    interpolated: bool,
}

impl Default for HeaderModel {
    fn default() -> Self {
        Self::new()
    }
}

impl HeaderModel {
    pub fn new() -> Self {
        HeaderModel {
            line: Vec::with_capacity(256),
            field: Field::None,
            expect_rev: false,
            pid: 0,
            rev: None,
            pre: BTreeMap::new(),
            post: BTreeMap::new(),
            post_bins: [0.0; POST_BINS],
            post_cdf: [0.0; POST_BINS + 1],
            post_dirty: true,
            pre_bucket: vec![[0, 0]; 1 << 10],
            pre_recent: 0.4,
            pre_scale: 1.0,
            ts_scale: 1.0,
            rev_pred: RevPred::default(),
            ts_pred: None,
            dist: ByteDist::default(),
            active: false,
            stats: HeaderStats::default(),
        }
    }

    fn pre_weight(&self) -> f64 {
        let b = &self.pre_bucket[(self.pid.max(0) as usize >> 12).min(1023)];
        let local = (b[0] as f64 + 1.0) / (b[0] as f64 + b[1] as f64 + 2.0);
        (0.5 * local + 0.5 * self.pre_recent).clamp(0.01, 0.99)
    }

    fn predict_rev(&mut self) {
        let w_pre = self.pre_weight();
        let lower = self
            .pre
            .range(..self.pid)
            .next_back()
            .map(|(&p, &r)| (p, r));
        let upper = self.pre.range(self.pid + 1..).next().map(|(&p, &r)| (p, r));
        let pre = match (lower, upper) {
            (Some((pl, rl)), Some((pu, ru))) if ru > rl + 1 => {
                let f = (self.pid - pl) as f64 / (pu - pl) as f64;
                let mu = rl as f64 + f * (ru - rl) as f64;
                let s = self.pre_scale * (0.5 + (f * (1.0 - f) * (ru - rl) as f64).sqrt());
                Some((mu, s, rl + 1, ru - 1))
            }
            (Some((pl, rl)), None) => {
                let gap = (self.pid - pl) as f64;
                Some((
                    rl as f64 + 2.0 * gap,
                    self.pre_scale * (2.0 + gap),
                    rl + 1,
                    MIGRATION_REV - 1,
                ))
            }
            (None, Some((pu, ru))) => {
                let gap = (pu - self.pid) as f64;
                Some((
                    ru as f64 - 2.0 * gap,
                    self.pre_scale * (2.0 + gap),
                    1,
                    ru - 1,
                ))
            }
            _ => None,
        };
        self.rev_pred = RevPred { w_pre, pre };
    }

    fn refresh_post_cdf(&mut self) {
        if self.post_dirty {
            let n: f64 = self.post_bins.iter().sum();
            let k = 0.05;
            let tot = n + k * POST_BINS as f64;
            self.post_cdf[0] = 0.0;
            for i in 0..POST_BINS {
                self.post_cdf[i + 1] = self.post_cdf[i] + (self.post_bins[i] + k) / tot;
            }
            self.post_dirty = false;
        }
    }

    fn post_mass(&self, lo: i64, hi: i64) -> f64 {
        let width = (1i64 << POST_BIN_SHIFT) as f64;
        let cdf = |x: i64| -> f64 {
            // mass of revisions < x
            let off = x - MIGRATION_REV;
            if off <= 0 {
                return 0.0;
            }
            let bin = (off >> POST_BIN_SHIFT) as usize;
            if bin >= POST_BINS {
                return 1.0;
            }
            let frac = (off - ((bin as i64) << POST_BIN_SHIFT)) as f64 / width;
            self.post_cdf[bin] + frac * (self.post_cdf[bin + 1] - self.post_cdf[bin])
        };
        (cdf(hi + 1) - cdf(lo)).max(0.0)
    }

    fn rev_mass(&self, lo: i64, hi: i64) -> f64 {
        let rp = self.rev_pred;
        let mut m = (1.0 - rp.w_pre) * self.post_mass(lo, hi);
        if let Some((mu, s, plo, phi)) = rp.pre {
            let (l, h) = (lo.max(plo), hi.min(phi));
            if l <= h {
                m += rp.w_pre * laplace_mass(l as f64, h as f64, mu, s);
            }
        } else {
            // No pre-migration neighbour yet: spread over 10M..17M.
            let (l, h) = (lo.max(10_000_000), hi.min(MIGRATION_REV - 1));
            if l <= h {
                m += rp.w_pre * (h - l + 1) as f64 / 7_000_000.0;
            }
        }
        m
    }

    fn predict_ts(&mut self, rev: i64) -> Option<TsPred> {
        if rev < MIGRATION_REV {
            return None;
        }
        let lower = self.post.range(..rev).next_back().map(|(&r, &t)| (r, t));
        let upper = self.post.range(rev + 1..).next().map(|(&r, &t)| (r, t));
        match (lower, upper) {
            (Some((rl, tl)), Some((ru, tu))) => {
                let f = (rev - rl) as f64 / (ru - rl) as f64;
                let span = (tu - tl).abs() as f64;
                let mu = tl as f64 + f * (tu - tl) as f64;
                let s = span * (f * (1.0 - f) / (ru - rl) as f64).sqrt() + 0.4;
                Some(TsPred {
                    mu,
                    s: s * self.ts_scale,
                    interpolated: true,
                })
            }
            (Some((rl, tl)), None) | (None, Some((rl, tl))) => {
                // Extrapolate with the edit rate of the nearest known pair.
                let rate = self.local_rate(rl).unwrap_or(1.0);
                let mu = tl as f64 + (rev - rl) as f64 / rate;
                let s = 0.5 * ((rev - rl).abs() as f64 / rate) + 30.0;
                Some(TsPred {
                    mu,
                    s,
                    interpolated: false,
                })
            }
            (None, None) => None,
        }
    }

    /// Edits per second around revision `r`, from two known neighbours.
    fn local_rate(&self, r: i64) -> Option<f64> {
        let a = self.post.range(..=r).next_back()?;
        let b = self
            .post
            .range(..*a.0)
            .next_back()
            .or_else(|| self.post.range(*a.0 + 1..).next())?;
        let (dr, dt) = ((a.0 - b.0) as f64, (a.1 - b.1) as f64);
        if dt.abs() < 1.0 {
            None
        } else {
            Some((dr / dt).abs().max(1e-3))
        }
    }

    fn ts_mass(&self, t0: i64, t1: i64) -> f64 {
        let p = match self.ts_pred {
            Some(p) => p,
            None => return 0.0,
        };
        let (a, b) = (t0 as f64, t1 as f64);
        0.86 * laplace_mass(a, b, p.mu, p.s)
            + 0.11 * laplace_mass(a, b, p.mu, 25.0 * p.s + 60.0)
            + 0.03 * laplace_mass(a, b, p.mu, 30.0 * 86400.0)
    }

    /// Next-character masses for the PHDA9 timestamp spelling, given the
    /// characters typed after "timestamp>".
    fn ts_next(&self, typed: &[u8]) -> Option<(Vec<(u8, f64)>, bool)> {
        let mut out: Vec<(u8, f64)> = Vec::with_capacity(12);
        let mut add = |c: u8, m: f64| {
            if m > 0.0 {
                match out.iter_mut().find(|x| x.0 == c) {
                    Some(x) => x.1 += m,
                    None => out.push((c, m)),
                }
            }
        };
        if typed.len() < 2 {
            for y in 2001..=2010i64 {
                let s = format!("{:02}", y - 2001);
                let s = s.as_bytes();
                if s.starts_with(typed) {
                    let t0 = days_from_civil(y, 1, 1) * 86400;
                    let t1 = days_from_civil(y + 1, 1, 1) * 86400 - 1;
                    add(s[typed.len()], self.ts_mass(t0, t1));
                }
            }
            return Some((out, false));
        }
        if !typed[..2].iter().all(u8::is_ascii_digit) {
            return None;
        }
        let year = 2001 + ((typed[0] - b'0') as i64) * 10 + (typed[1] - b'0') as i64;
        let rest = &typed[2..];
        match rest.iter().position(|&c| c == b':') {
            None => {
                // Day-index stage: enumerate the valid dates of the year.
                for m in 1..=12 {
                    for d in 1..=days_in_month(year, m) {
                        let di = (m - 1) * 31 + (d - 1);
                        let s = di.to_string();
                        let s = s.as_bytes();
                        if s.starts_with(rest) {
                            let t0 = days_from_civil(year, m, d) * 86400;
                            let c = if s.len() > rest.len() {
                                s[rest.len()]
                            } else {
                                b':'
                            };
                            add(c, self.ts_mass(t0, t0 + 86399));
                        }
                    }
                }
                Some((out, false))
            }
            Some(colon) => {
                let ds = &rest[..colon];
                if ds.is_empty() || !ds.iter().all(u8::is_ascii_digit) {
                    return None;
                }
                let di: i64 = std::str::from_utf8(ds).ok()?.parse().ok()?;
                let (m, d) = (di / 31 + 1, di % 31 + 1);
                if m > 12 || d > days_in_month(year, m) {
                    return None;
                }
                let base = days_from_civil(year, m, d) * 86400;
                let secs = &rest[colon + 1..];
                let masses = decimal_next(secs, 0, 86399, &|a, b| self.ts_mass(base + a, base + b));
                for (i, &v) in masses.iter().enumerate() {
                    add(if i == 10 { b'\n' } else { b'0' + i as u8 }, v);
                }
                Some((out, true))
            }
        }
    }

    fn parse_ts(v: &[u8]) -> Option<i64> {
        if v.len() < 4 {
            return None;
        }
        let s = std::str::from_utf8(v).ok()?;
        let year = 2001 + s.get(..2)?.parse::<i64>().ok()?;
        let (d, secs) = s[2..].split_once(':')?;
        let di: i64 = d.parse().ok()?;
        let secs: i64 = secs.parse().ok()?;
        let (m, day) = (di / 31 + 1, di % 31 + 1);
        Some(days_from_civil(year, m, day) * 86400 + secs)
    }

    fn end_line(&mut self) {
        let line = std::mem::take(&mut self.line);
        if let Some(rest) = line.strip_prefix(b">") {
            if let Some(delta) = std::str::from_utf8(rest)
                .ok()
                .and_then(|s| s.parse::<i64>().ok())
            {
                self.pid += delta;
                self.rev = None;
                self.stats.pages += 1;
            }
        } else if line == b"revision>" {
            self.expect_rev = true;
            self.predict_rev();
        } else if self.expect_rev && line.starts_with(b"id>") {
            self.expect_rev = false;
            if let Some(r) = std::str::from_utf8(&line[3..])
                .ok()
                .and_then(|s| s.parse::<i64>().ok())
            {
                self.rev = Some(r);
                self.learn_rev(r);
                self.ts_pred = self.predict_ts(r);
            }
        } else if let Some(v) = line.strip_prefix(b"timestamp>") {
            if let (Some(t), Some(r)) = (Self::parse_ts(v), self.rev)
                && r >= MIGRATION_REV
            {
                if let Some(p) = self.ts_pred.filter(|p| p.interpolated) {
                    let z = ((t as f64 - p.mu).abs() / p.s).min(20.0);
                    self.ts_scale = (0.995 * self.ts_scale + 0.005 * self.ts_scale * z.max(0.05))
                        .clamp(0.2, 20.0);
                    self.stats.ts_predicted += 1;
                }
                self.post.insert(r, t);
            }
            self.ts_pred = None;
        }
        self.line = line;
        self.line.clear();
    }

    fn learn_rev(&mut self, r: i64) {
        let is_pre = r < MIGRATION_REV;
        let b = &mut self.pre_bucket[(self.pid.max(0) as usize >> 12).min(1023)];
        b[if is_pre { 0 } else { 1 }] += 1;
        self.pre_recent = 0.98 * self.pre_recent + 0.02 * if is_pre { 1.0 } else { 0.0 };
        if is_pre {
            self.stats.pre_pages += 1;
            if let Some((mu, s, _, _)) = self.rev_pred.pre {
                let z = ((r as f64 - mu).abs() / s).min(20.0);
                self.pre_scale =
                    (0.99 * self.pre_scale + 0.01 * self.pre_scale * z.max(0.05)).clamp(0.1, 50.0);
            }
            self.pre.insert(self.pid, r);
        } else {
            self.stats.post_pages += 1;
            let bin = ((r - MIGRATION_REV) >> POST_BIN_SHIFT) as usize;
            if bin < POST_BINS {
                self.post_bins[bin] += 1.0;
                self.post_dirty = true;
            }
        }
    }

    fn refresh(&mut self) {
        self.active = false;
        self.field = Field::None;
        if self.expect_rev && self.line.starts_with(b"id>") {
            self.field = Field::RevId;
            self.refresh_post_cdf();
            let masses = decimal_next(&self.line[3..], 1, MAX_REV, &|a, b| self.rev_mass(a, b));
            let mut d = std::mem::take(&mut self.dist);
            self.active = to_dist(&masses, b'\n', 0.002, &mut d);
            self.dist = d;
        } else if self.ts_pred.is_some() && self.line.starts_with(b"timestamp>") {
            self.field = Field::Timestamp;
            let typed = self.line[10..].to_vec();
            if let Some((m, _)) = self.ts_next(&typed) {
                let tot: f64 = m.iter().map(|x| x.1).sum();
                if tot > 0.0 && tot.is_finite() {
                    self.dist.clear();
                    for (c, v) in m {
                        self.dist.cand.push((c, (v / tot) as f32));
                    }
                    self.dist.normalise(0.002);
                    self.active = true;
                }
            }
        }
    }
}

impl SideModel for HeaderModel {
    fn update(&mut self, hist: &[u8]) {
        let b = *hist.last().unwrap();
        if b == b'\n' {
            self.end_line();
        } else {
            self.line.push(b);
        }
        self.refresh();
    }

    fn dist(&self) -> Option<&ByteDist> {
        if self.active { Some(&self.dist) } else { None }
    }

    fn mix_ctx(&self) -> usize {
        match self.field {
            Field::RevId => 1,
            Field::Timestamp => 2,
            Field::None => 1,
        }
    }
}
