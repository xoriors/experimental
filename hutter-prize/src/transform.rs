//! Reversible transforms: the cheapest way to deploy two of the side models.
//!
//! Instead of a new model inside the compressor, rewrite the PHDA9 tail so
//! that any compressor sees small residuals and escapes:
//!
//! * header: a pre-migration revision id becomes `id>~r`, where r is its
//!   distance from the interpolation between the nearest pre-migration pages
//!   by page id; a post-migration timestamp becomes `timestamp>~r`, where r is
//!   its distance in seconds from the interpolation between the nearest pages
//!   by revision id;
//! * interwiki: a title starting with the article's English title has that
//!   prefix replaced by the byte 0x01.
//!
//! Both inverses rebuild the same interpolation tables from what they have
//! already restored, so they need no side data. Lines whose spelling would
//! not survive a parse/print round trip are left untouched.

use std::collections::BTreeMap;

use crate::side::numfmt::days_from_civil;

const MIGRATION_REV: i64 = 17_000_000;
const ESC: u8 = 0x01;

#[derive(Default)]
struct Clock {
    pid: i64,
    after_revision: bool,
    rev: Option<i64>,
    pre: BTreeMap<i64, i64>,
    post: BTreeMap<i64, i64>,
}

impl Clock {
    fn predict_rev(&self) -> Option<i64> {
        let lo = self.pre.range(..self.pid).next_back();
        let hi = self.pre.range(self.pid + 1..).next();
        match (lo, hi) {
            (Some((&pl, &rl)), Some((&pu, &ru))) => Some(
                rl + ((ru - rl) as f64 * (self.pid - pl) as f64 / (pu - pl) as f64).round() as i64,
            ),
            (Some((&pl, &rl)), None) => Some(rl + 2 * (self.pid - pl)),
            _ => None,
        }
    }

    fn predict_ts(&self, rev: i64) -> Option<i64> {
        if rev < MIGRATION_REV {
            return None;
        }
        let (&rl, &tl) = self.post.range(..rev).next_back()?;
        let (&ru, &tu) = self.post.range(rev + 1..).next()?;
        Some(tl + ((tu - tl) as f64 * (rev - rl) as f64 / (ru - rl) as f64).round() as i64)
    }

    fn learn_rev(&mut self, r: i64) {
        self.rev = Some(r);
        if r < MIGRATION_REV {
            self.pre.insert(self.pid, r);
        }
    }

    fn learn_ts(&mut self, t: i64) {
        if let Some(r) = self.rev.filter(|&r| r >= MIGRATION_REV) {
            self.post.insert(r, t);
        }
    }
}

fn parse_i64(s: &[u8]) -> Option<i64> {
    std::str::from_utf8(s).ok()?.parse().ok()
}

fn ts_parse(v: &[u8]) -> Option<i64> {
    let s = std::str::from_utf8(v).ok()?;
    let year = 2001 + s.get(..2)?.parse::<i64>().ok()?;
    let (d, secs) = s[2..].split_once(':')?;
    let (di, secs): (i64, i64) = (d.parse().ok()?, secs.parse().ok()?);
    Some(days_from_civil(year, di / 31 + 1, di % 31 + 1) * 86400 + secs)
}

fn ts_print(t: i64) -> String {
    let (days, secs) = (t.div_euclid(86400), t.rem_euclid(86400));
    // Inverse of days_from_civil (Howard Hinnant's civil_from_days).
    let z = days + 719468;
    let era = z.div_euclid(146097);
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{:02}{}:{}", y - 2001, m * 31 + d - 32, secs)
}

fn lines(s: &[u8]) -> impl Iterator<Item = &[u8]> {
    s.split_inclusive(|&c| c == b'\n')
}

/// Header stream -> residual form.
pub fn header_forward(h: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(h.len());
    let mut c = Clock::default();
    for line in lines(h) {
        let body = line.strip_suffix(b"\n").unwrap_or(line);
        let nl = &line[body.len()..];
        if let Some(d) = body.strip_prefix(b">").and_then(parse_i64) {
            c.pid += d;
            c.rev = None;
        } else if body == b"revision>" {
            c.after_revision = true;
        } else if c.after_revision && body.starts_with(b"id>") {
            c.after_revision = false;
            if let Some(r) =
                parse_i64(&body[3..]).filter(|r| r.to_string().as_bytes() == &body[3..])
            {
                let pred = c.predict_rev().filter(|_| r < MIGRATION_REV);
                c.learn_rev(r);
                if let Some(p) = pred {
                    out.extend_from_slice(format!("id>~{}", r - p).as_bytes());
                    out.extend_from_slice(nl);
                    continue;
                }
            }
        } else if let Some(v) = body.strip_prefix(b"timestamp>")
            && let Some(t) = ts_parse(v).filter(|&t| ts_print(t).as_bytes() == v)
        {
            let pred = c.rev.and_then(|r| c.predict_ts(r));
            c.learn_ts(t);
            if let Some(p) = pred {
                out.extend_from_slice(format!("timestamp>~{}", t - p).as_bytes());
                out.extend_from_slice(nl);
                continue;
            }
        }
        out.extend_from_slice(line);
    }
    out
}

/// Residual form -> header stream.
pub fn header_inverse(x: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(x.len() + x.len() / 8);
    let mut c = Clock::default();
    for line in lines(x) {
        let body = line.strip_suffix(b"\n").unwrap_or(line);
        let nl = &line[body.len()..];
        if let Some(d) = body.strip_prefix(b">").and_then(parse_i64) {
            c.pid += d;
            c.rev = None;
        } else if body == b"revision>" {
            c.after_revision = true;
        } else if c.after_revision && body.starts_with(b"id>") {
            c.after_revision = false;
            if let Some(res) = body.strip_prefix(b"id>~").and_then(parse_i64) {
                let r = c.predict_rev().expect("residual without prediction") + res;
                c.learn_rev(r);
                out.extend_from_slice(format!("id>{r}").as_bytes());
                out.extend_from_slice(nl);
                continue;
            }
            if let Some(r) = parse_i64(&body[3..]) {
                c.learn_rev(r);
            }
        } else if let Some(v) = body.strip_prefix(b"timestamp>") {
            if let Some(res) = v.strip_prefix(b"~").and_then(parse_i64) {
                let t = c
                    .rev
                    .and_then(|r| c.predict_ts(r))
                    .expect("residual without prediction")
                    + res;
                c.learn_ts(t);
                out.extend_from_slice(b"timestamp>");
                out.extend_from_slice(ts_print(t).as_bytes());
                out.extend_from_slice(nl);
                continue;
            }
            if let Some(t) = ts_parse(v) {
                c.learn_ts(t);
            }
        }
        out.extend_from_slice(line);
    }
    out
}

/// Interwiki stream -> escaped form. `titles[i]` is the English title of block `i`.
pub fn lang_forward(lang: &[u8], titles: &[Vec<u8>]) -> Vec<u8> {
    assert!(!lang.contains(&ESC), "escape byte occurs in the stream");
    let mut out = Vec::with_capacity(lang.len());
    let mut block = 0;
    for line in lines(lang) {
        let english = titles.get(block).map(Vec::as_slice).unwrap_or(b"");
        match title_span(line) {
            Some((a, b)) if !english.is_empty() && line[a..b].starts_with(english) => {
                out.extend_from_slice(&line[..a]);
                out.push(ESC);
                out.extend_from_slice(&line[a + english.len()..]);
            }
            _ => out.extend_from_slice(line),
        }
        if crate::enwik::find(line, b"</text>").is_some() {
            block += 1;
        }
    }
    out
}

pub fn lang_inverse(x: &[u8], titles: &[Vec<u8>]) -> Vec<u8> {
    let mut out = Vec::with_capacity(x.len() * 2);
    let mut block = 0;
    for line in lines(x) {
        let english = titles.get(block).map(Vec::as_slice).unwrap_or(b"");
        match title_span(line) {
            Some((a, _)) if line.get(a) == Some(&ESC) => {
                out.extend_from_slice(&line[..a]);
                out.extend_from_slice(english);
                out.extend_from_slice(&line[a + 1..]);
            }
            _ => out.extend_from_slice(line),
        }
        if crate::enwik::find(line, b"</text>").is_some() {
            block += 1;
        }
    }
    out
}

/// Byte range of the title in "[[code:title]]...".
fn title_span(line: &[u8]) -> Option<(usize, usize)> {
    if !line.starts_with(b"[[") {
        return None;
    }
    let colon = line.iter().position(|&c| c == b':')?;
    let close = crate::enwik::find(line, b"]]")?;
    (colon < close && line[2..colon].iter().all(u8::is_ascii_lowercase))
        .then_some((colon + 1, close))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timestamps_print_like_phda9() {
        let t = days_from_civil(2006, 3, 4) * 86400 + 6085;
        assert_eq!(ts_print(t), "0565:6085");
        assert_eq!(ts_parse(b"0565:6085"), Some(t));
    }

    #[test]
    fn header_round_trip() {
        let mut h = String::new();
        // Pre-migration pages with revision ids increasing in page id, and
        // post-migration ones whose timestamps follow revision ids.
        for (pid, rev, ts) in [
            (5, 15_000_010, "0155:1000"),
            (9, 15_000_030, "0255:2000"),
            (7, 15_000_021, "0355:3000"),
            (20, 30_000_000, "0565:6085"),
            (21, 40_000_000, "0566:6085"),
            (22, 35_000_000, "0565:50000"),
        ] {
            h += &format!(
                ">{}\nrevision>\nid>{rev}\ntimestamp>{ts}\ncontributor>\nip>1.2.3.4\n/contributor>\n",
                pid - 0
            );
        }
        // Page ids in the stream are deltas.
        let mut prev = 0;
        let h: String = h
            .lines()
            .map(|l| {
                if let Some(p) = l.strip_prefix('>') {
                    let p: i64 = p.parse().unwrap();
                    let d = p - prev;
                    prev = p;
                    format!(">{d}\n")
                } else {
                    format!("{l}\n")
                }
            })
            .collect();
        let f = header_forward(h.as_bytes());
        assert!(f.windows(4).any(|w| w == b"id>~"));
        assert!(f.windows(11).any(|w| w == b"timestamp>~"));
        assert_eq!(header_inverse(&f), h.as_bytes());
    }

    #[test]
    fn lang_round_trip() {
        let lang = b"[[de:Anarchismus]]\n[[fr:Anarchisme]]</text>\n[[de:947]]\n[[ko:947\xeb\x85\x84]]</text>\n";
        let titles = vec![b"Anarchism".to_vec(), b"947".to_vec()];
        let f = lang_forward(lang, &titles);
        assert_eq!(
            f,
            b"[[de:\x01us]]\n[[fr:\x01e]]</text>\n[[de:\x01]]\n[[ko:\x01\xeb\x85\x84]]</text>\n"
        );
        assert_eq!(lang_inverse(&f, &titles), lang);
    }
}
