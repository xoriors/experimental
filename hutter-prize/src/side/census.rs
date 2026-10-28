//! Census side model: arithmetic inside Rambot's US-place articles.
//!
//! About 36,500 enwik9 articles were generated in 2002 from US census tables
//! ("Rambot"). Their numbers are tied together by arithmetic that no context
//! model and no small transformer can carry out:
//!
//! * every area is printed in km² and then in mi²: mi² = km² / 2.589988;
//! * every density is printed per km² and then per mi²: × 2.589988;
//! * population and housing densities are counts printed earlier in the
//!   article divided by the land area printed earlier still;
//! * "The total area is P% water" is water / total;
//! * the last share in the racial-makeup and age-distribution lists is
//!   100 minus the others.
//!
//! The model parses the text as it is coded, keeps the article's facts, and
//! when a sentence reaches the place where a derived number goes, offers a
//! few candidate spellings of it. Candidate classes (exact rounding, one unit
//! off, other precision) learn their own hit rates.

use super::numfmt::candidates_next;
use super::{ByteDist, SideModel};
use crate::enwik::find;
use crate::report::Labels;

const MI_PER_KM: f64 = 1.0 / 2.589988;

pub fn is_census_page(page: &[u8]) -> bool {
    find(page, b"housing units at an average density of").is_some()
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    AreaMi = 0,
    DensityMi = 1,
    PopDensity = 2,
    HouseDensity = 3,
    WaterPct = 4,
    RaceLast = 5,
    AgeLast = 6,
}

const KINDS: usize = 7;
const CLASSES: usize = 6;
pub const KIND_NAMES: [&str; KINDS] = [
    "area in mi² (from km²)",
    "density per mi² (from per km²)",
    "population density (count / land area)",
    "housing density (count / land area)",
    "water % (water / total area)",
    "last racial share (100 - others)",
    "last age share (100 - others)",
];

#[derive(Clone, Copy, Debug, Default)]
struct Num {
    v: f64,
    dec: u8,
    end: usize,
}

/// An area known from its printed km² and (once seen) mi² values, as an
/// interval of the true km² value.
#[derive(Clone, Copy, Debug)]
struct Area {
    lo: f64,
    hi: f64,
}

impl Area {
    fn from_km(km: Num) -> Self {
        let h = 0.5 * 10f64.powi(-(km.dec as i32));
        Area {
            lo: km.v - h,
            hi: km.v + h,
        }
    }
    fn refine_mi(&mut self, mi: Num) {
        let h = 0.5 * 10f64.powi(-(mi.dec as i32));
        let (lo, hi) = ((mi.v - h) * 2.589988, (mi.v + h) * 2.589988);
        if lo.max(self.lo) <= hi.min(self.hi) {
            self.lo = lo.max(self.lo);
            self.hi = hi.min(self.hi);
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ListMode {
    None,
    Race,
    Age,
}

/// A derived number is due: its kind, candidate (value, decimals, class)
/// triples, and the byte expected right after it.
type Trigger = (Kind, Vec<(f64, u8, usize)>, u8);

/// Article state shared by the model and the labeller.
struct Parser {
    pos: usize,
    tail: Vec<u8>,
    tok: Vec<u8>,
    nums: Vec<Num>,
    population: Option<f64>,
    housing: Option<f64>,
    pending_area: Option<(Num, bool)>,
    last_area: Option<Area>,
    total: Option<Area>,
    land: Option<Area>,
    water: Option<Area>,
    in_total_sentence: bool,
    list: ListMode,
    list_sum: f64,
    /// Count and land area behind the density being printed, so that its
    /// per-mi² twin can be pinned down from both sides.
    density_basis: Option<(f64, Area)>,
}

/// A derived number about to be typed.
struct Pending {
    kind: Kind,
    cands: Vec<(Vec<u8>, f32, usize)>,
    term: u8,
    typed: Vec<u8>,
}

impl Parser {
    fn new() -> Self {
        Parser {
            pos: 0,
            tail: Vec::with_capacity(512),
            tok: Vec::new(),
            nums: Vec::new(),
            population: None,
            housing: None,
            pending_area: None,
            last_area: None,
            total: None,
            land: None,
            water: None,
            in_total_sentence: false,
            list: ListMode::None,
            list_sum: 0.0,
            density_basis: None,
        }
    }

    fn ends(&self, pat: &[u8]) -> bool {
        self.tail.ends_with(pat)
    }

    fn last_num_before(&self, back: usize) -> Option<Num> {
        let n = *self.nums.last()?;
        (self.pos - n.end <= back).then_some(n)
    }

    /// Feeds one byte; returns a trigger if a derived number comes next.
    fn push(&mut self, b: u8) -> Option<Trigger> {
        self.pos += 1;
        if self.tail.len() >= 512 {
            self.tail.drain(..256);
        }
        self.tail.push(b);
        // Numbers: digits with "," groups and one "."; digits glued to a
        // word ("sup2", "H2O") are not numbers.
        let prev = if self.tail.len() >= 2 {
            self.tail[self.tail.len() - 2]
        } else {
            b' '
        };
        let starts = b.is_ascii_digit() && !prev.is_ascii_alphabetic();
        if (self.tok.is_empty() && starts)
            || (!self.tok.is_empty() && (b.is_ascii_digit() || b == b',' || b == b'.'))
        {
            self.tok.push(b);
        } else if !self.tok.is_empty() {
            let mut t = std::mem::take(&mut self.tok);
            while matches!(t.last(), Some(b',') | Some(b'.')) {
                t.pop();
            }
            if let Some(n) = parse_num(&t, self.pos - 1) {
                self.nums.push(n);
                if self.nums.len() > 64 {
                    self.nums.drain(..32);
                }
                if b == b'%' && self.list != ListMode::None {
                    self.list_sum += n.v;
                }
            }
        }
        if self.ends(b"  <page>") {
            *self = Parser {
                pos: self.pos,
                ..Parser::new()
            };
            return None;
        }
        if self.ends(b" people") {
            self.population = self.last_num_before(8).map(|n| n.v);
        }
        if self.ends(b" housing units") {
            self.housing = self.last_num_before(15).map(|n| n.v);
        }
        if self.ends(b"total area of ") {
            self.in_total_sentence = true;
        }
        if self.ends(b"of it is land") {
            self.land = self.last_area;
        }
        if self.ends(b"of it is water") {
            self.water = self.last_area;
        }
        if self.ends(b"racial makeup of the") {
            self.list = ListMode::Race;
            self.list_sum = 0.0;
        }
        if self.ends(b"spread out with") {
            self.list = ListMode::Age;
            self.list_sum = 0.0;
        }
        // An area pair "X km² (Y mi²)" completes: remember it.
        if (self.ends(b"mi&amp;sup2;)") || self.ends(b"mi&amp;sup2;]])"))
            && let (Some((km, _)), Some(mi)) = (self.pending_area.take(), self.last_num_before(30))
        {
            let mut a = Area::from_km(km);
            a.refine_mi(mi);
            self.last_area = Some(a);
            if self.in_total_sentence && self.total.is_none() {
                self.total = Some(a);
                self.in_total_sentence = false;
            }
        }
        // Triggers.
        if self.ends(b"/km&amp;sup2; (") || self.ends(b"/km&amp;sup2;]] (") {
            let x = self.last_num_before(24)?;
            let basis = self.density_basis.take();
            if let Some(c) = basis.and_then(|(count, land)| density_twin(x, count, land)) {
                return Some((Kind::DensityMi, c, b'/'));
            }
            return Some((Kind::DensityMi, conversions(x.v * 2.589988, x.dec), b'/'));
        }
        if self.ends(b"/mi&amp;sup2; (") || self.ends(b"/mi&amp;sup2;]] (") {
            let x = self.last_num_before(24)?;
            return Some((Kind::DensityMi, conversions(x.v * MI_PER_KM, x.dec), b'/'));
        }
        if self.ends(b"km&amp;sup2; (") || self.ends(b"km&amp;sup2;]] (") {
            let x = self.last_num_before(60)?;
            self.pending_area = Some((x, true));
            return Some((Kind::AreaMi, conversions(x.v * MI_PER_KM, x.dec), b' '));
        }
        if self.ends(b"mi&amp;sup2; (") || self.ends(b"mi&amp;sup2;]] (") {
            let x = self.last_num_before(60)?;
            return Some((Kind::AreaMi, conversions(x.v * 2.589988, x.dec), b' '));
        }
        if self.ends(b"population density]] is ")
            || self.ends(b"population density is ")
            || self.ends(b"population density]] was ")
            || self.ends(b"population density was ")
        {
            let (count, land) = (self.population?, self.land?);
            self.density_basis = Some((count, land));
            return Some((Kind::PopDensity, per_area(count, land), b'/'));
        }
        if self.ends(b"housing units at an average density of ") {
            let (count, land) = (self.housing?, self.land?);
            self.density_basis = Some((count, land));
            return Some((Kind::HouseDensity, per_area(count, land), b'/'));
        }
        if self.ends(b"The total area is ") {
            let (w, t) = (self.water?, self.total?);
            let (lo, hi) = (100.0 * w.lo / t.hi, 100.0 * w.hi / t.lo.max(1e-9));
            return Some((Kind::WaterPct, grid(lo, hi, 2, 60)?, b'%'));
        }
        if self.list != ListMode::None && self.ends(b", and ") {
            let (kind, dec) = if self.list == ListMode::Race {
                (Kind::RaceLast, 2)
            } else {
                (Kind::AgeLast, 1)
            };
            let rest = 100.0 - self.list_sum;
            self.list = ListMode::None;
            if !(0.0..=100.0).contains(&rest) {
                return None;
            }
            let u = 10f64.powi(-dec);
            let mut c = vec![(rest, dec as u8, 0)];
            for k in 1..=2 {
                c.push((rest + k as f64 * u, dec as u8, k));
                c.push((rest - k as f64 * u, dec as u8, k));
            }
            return Some((kind, c, b'%'));
        }
        None
    }
}

/// Candidates for a converted value printed with `dec` decimals:
/// (value, decimals, candidate class).
fn conversions(y: f64, dec: u8) -> Vec<(f64, u8, usize)> {
    let u = 10f64.powi(-(dec as i32));
    let mut c = vec![
        (y, dec, 0),
        (y + u, dec, 1),
        (y - u, dec, 1),
        (y, dec + 1, 2),
    ];
    if dec > 0 {
        c.push((y, dec - 1, 3));
    }
    c
}

/// The per-mi² twin of a density printed per km² as `x`, when the count and
/// land area behind it are known: both constraints together usually leave a
/// single one-decimal value.
fn density_twin(x: Num, count: f64, land: Area) -> Option<Vec<(f64, u8, usize)>> {
    if land.lo <= 0.0 {
        return None;
    }
    let h = 0.5 * 10f64.powi(-(x.dec as i32));
    let lo = (count / land.hi).max(x.v - h) * 2.589988;
    let hi = (count / land.lo).min(x.v + h) * 2.589988;
    if lo > hi {
        return None;
    }
    let mut c = grid(lo, hi, x.dec as i32, 20)?;
    c.extend(
        conversions(x.v * 2.589988, x.dec)
            .into_iter()
            .map(|(v, d, k)| (v, d, k.max(1))),
    );
    Some(c)
}

/// A count divided by an area known to an interval.
fn per_area(count: f64, land: Area) -> Vec<(f64, u8, usize)> {
    if land.lo <= 0.0 {
        return Vec::new();
    }
    let (lo, hi) = (count / land.hi, count / land.lo);
    let mut c: Vec<(f64, u8, usize)> = grid(lo, hi, 1, 40).unwrap_or_default();
    let mid = 0.5 * (lo + hi);
    c.push((mid, 0, 4));
    c.push((mid - 0.1, 1, 5));
    c.push((mid + 0.1, 1, 5));
    c.push((lo - 0.1, 1, 5));
    c.push((hi + 0.1, 1, 5));
    c
}

/// Every value with `dec` decimals in [lo, hi], if there are at most `max`.
fn grid(lo: f64, hi: f64, dec: i32, max: usize) -> Option<Vec<(f64, u8, usize)>> {
    let s = 10f64.powi(dec);
    let (a, b) = ((lo * s).floor() as i64, (hi * s).ceil() as i64);
    if b < a || (b - a) as usize > max {
        return None;
    }
    Some((a..=b).map(|k| (k as f64 / s, dec as u8, 0)).collect())
}

fn parse_num(t: &[u8], end: usize) -> Option<Num> {
    let s: String = t
        .iter()
        .filter(|&&c| c != b',')
        .map(|&c| c as char)
        .collect();
    let v: f64 = s.parse().ok()?;
    let dec = s.split_once('.').map_or(0, |(_, f)| f.len()) as u8;
    Some(Num { v, dec, end })
}

/// Spelling with thousands separators, as Rambot printed numbers.
fn spell(v: f64, dec: u8) -> Option<Vec<u8>> {
    if !(0.0..=1e12).contains(&v) {
        return None;
    }
    let s = format!("{:.*}", dec as usize, v);
    let (int, frac) = match s.split_once('.') {
        Some((i, f)) => (i.to_string(), Some(f.to_string())),
        None => (s.clone(), None),
    };
    let mut out = Vec::new();
    for (i, c) in int.bytes().enumerate() {
        if i > 0 && (int.len() - i) % 3 == 0 {
            out.push(b',');
        }
        out.push(c);
    }
    if let Some(f) = frac {
        out.push(b'.');
        out.extend_from_slice(f.as_bytes());
    }
    Some(out)
}

pub struct CensusModel {
    parser: Parser,
    pending: Option<Pending>,
    stats: [[f32; 2]; KINDS * CLASSES],
    dist: ByteDist,
    active: bool,
}

impl Default for CensusModel {
    fn default() -> Self {
        Self::new()
    }
}

impl CensusModel {
    pub fn new() -> Self {
        CensusModel {
            parser: Parser::new(),
            pending: None,
            stats: [[0.0; 2]; KINDS * CLASSES],
            dist: ByteDist::default(),
            active: false,
        }
    }

    fn class_p(&self, kind: Kind, class: usize) -> f32 {
        let s = self.stats[kind as usize * CLASSES + class];
        let prior = if class == 0 { 0.6 } else { 0.1 };
        (s[0] + prior) / (s[1] + 1.0)
    }

    fn make_pending(&self, kind: Kind, vals: Vec<(f64, u8, usize)>, term: u8) -> Option<Pending> {
        let mut cands: Vec<(Vec<u8>, f32, usize)> = Vec::new();
        let n0 = vals.iter().filter(|v| v.2 == 0).count().max(1) as f32;
        for (v, dec, class) in vals {
            let Some(s) = spell(v, dec) else { continue };
            if cands.iter().any(|c| c.0 == s) {
                continue;
            }
            let share = if class == 0 { n0 } else { 1.0 };
            cands.push((s, self.class_p(kind, class) / share, class));
        }
        (!cands.is_empty()).then(|| Pending {
            kind,
            cands,
            term,
            typed: Vec::new(),
        })
    }

    fn finish(&mut self, p: &Pending) {
        let hit = p.cands.iter().find(|c| c.0 == p.typed).map(|c| c.2);
        let mut seen = [false; CLASSES];
        for c in &p.cands {
            if !seen[c.2] {
                seen[c.2] = true;
                let s = &mut self.stats[p.kind as usize * CLASSES + c.2];
                s[1] += 1.0;
                if hit == Some(c.2) {
                    s[0] += 1.0;
                }
            }
        }
    }

    fn refresh(&mut self) {
        self.active = false;
        if let Some(p) = &self.pending {
            let cands: Vec<(Vec<u8>, f32)> = p.cands.iter().map(|c| (c.0.clone(), c.1)).collect();
            self.active = candidates_next(&cands, &p.typed, p.term, 0.03, &mut self.dist);
        }
    }
}

impl SideModel for CensusModel {
    fn update(&mut self, hist: &[u8]) {
        let b = *hist.last().unwrap();
        if let Some(mut p) = self.pending.take() {
            let open = p.cands.iter().any(|c| {
                c.0.len() > p.typed.len() && c.0.starts_with(&p.typed) && c.0[p.typed.len()] == b
            });
            if open {
                p.typed.push(b);
                self.pending = Some(p);
            } else {
                self.finish(&p);
            }
        }
        if let Some((kind, vals, term)) = self.parser.push(b)
            && self.pending.is_none()
        {
            self.pending = self.make_pending(kind, vals, term);
        }
        self.refresh();
    }

    fn dist(&self) -> Option<&ByteDist> {
        if self.active { Some(&self.dist) } else { None }
    }

    fn mix_ctx(&self) -> usize {
        match self.pending.as_ref().map(|p| p.kind) {
            Some(Kind::AreaMi) | Some(Kind::DensityMi) => 3,
            Some(Kind::RaceLast) | Some(Kind::AgeLast) => 2,
            _ => 1,
        }
    }

    fn ctx(&self) -> [u64; 2] {
        match &self.pending {
            Some(p) => [1 + p.kind as u64 * 64 + p.typed.len().min(63) as u64, 0],
            None => [0, 0],
        }
    }
}

/// Labels every derived number (the bytes after a trigger, up to the end of
/// the number): its first digit separately from the rest, since a
/// transformer may learn leading digits of a conversion but not trailing ones.
pub fn labels(text: &[u8]) -> Labels {
    let mut names: Vec<String> = Vec::new();
    for k in KIND_NAMES {
        names.push(format!("{k}: first digit"));
        names.push(format!("{k}: other digits"));
    }
    names.push("other text".to_string());
    let other = (2 * KINDS) as u8;
    let mut of = vec![other; text.len()];
    let mut parser = Parser::new();
    let mut open: Option<(Kind, bool)> = None;
    for (i, &b) in text.iter().enumerate() {
        if let Some((kind, first)) = open {
            if b.is_ascii_digit() || b == b'.' || b == b',' {
                of[i] = 2 * kind as u8 + if first { 0 } else { 1 };
                open = Some((kind, false));
            } else {
                open = None;
            }
        }
        if let Some((kind, _, _)) = parser.push(b) {
            open = Some((kind, true));
        }
    }
    Labels { names, of }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spells_like_rambot() {
        assert_eq!(spell(1961.1, 1).unwrap(), b"1,961.1");
        assert_eq!(spell(0.04, 2).unwrap(), b"0.04");
        assert_eq!(spell(100368.0, 0).unwrap(), b"100,368");
    }

    #[test]
    fn predicts_conversions() {
        let text = b"  <page>\nhas a total area of 55.9 [[square kilometre|km&amp;sup2;]] (21.6 [[square mile|mi&amp;sup2;]]).";
        let mut p = Parser::new();
        let mut got = None;
        for &b in text.iter() {
            if let Some((k, v, _)) = p.push(b) {
                got = Some((k, v));
            }
        }
        let (k, v) = got.unwrap();
        assert_eq!(k, Kind::AreaMi);
        assert_eq!(spell(v[0].0, v[0].1).unwrap(), b"21.6");
    }
}
