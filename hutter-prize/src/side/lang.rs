//! Interwiki side model: a link in another language usually names the same
//! subject, so its title is often the English title copied verbatim (36% of
//! links) or a close variant.
//!
//! PHDA9 moves every article's trailing interwiki block into one stream after
//! all article text, so a generic model coding "[[de:...]]" no longer sees
//! the article it belongs to. The decoder can still tell which article that
//! is: an article whose text lacks "</text>" in the main stream had its block
//! moved, and blocks appear in article order. This model is given those
//! English titles and predicts each foreign title as an aligned copy of the
//! English title or of an earlier title in the same block.

use super::{ByteDist, SideModel};
use crate::cm::hash2;

#[derive(Clone, Copy, PartialEq, Eq)]
enum State {
    LineStart,
    Code,
    Title(usize),
    After,
}

pub struct LangModel {
    titles: Vec<Vec<u8>>,
    block: usize,
    line: Vec<u8>,
    state: State,
    code: u64,
    block_titles: Vec<Vec<u8>>,
    /// Hit statistics per predictor context (see `predict`).
    stats: Vec<[f32; 2]>,
    preds: Vec<(u8, usize)>,
    dist: ByteDist,
    active: bool,
    ctx: [u64; 2],
}

const CODE_BUCKETS: usize = 64;
/// Predictor kinds: aligned copy of the English title, aligned copy of an
/// earlier title in the block, and the same two after re-synchronising on
/// the longest typed suffix that occurs in the source.
const KINDS: usize = 4;
/// Sub-contexts per predictor kind and language bucket.
const SUBS: usize = 32;

impl LangModel {
    /// `titles[i]` is the English title of the article that owns block `i`.
    pub fn new(titles: Vec<Vec<u8>>) -> Self {
        LangModel {
            titles,
            block: 0,
            line: Vec::with_capacity(256),
            state: State::LineStart,
            code: 0,
            block_titles: Vec::new(),
            stats: vec![[0.0, 0.0]; KINDS * CODE_BUCKETS * SUBS],
            preds: Vec::with_capacity(4),
            dist: ByteDist::default(),
            active: false,
            ctx: [0, 0],
        }
    }

    fn prob(&self, k: usize) -> f32 {
        let s = self.stats[k];
        ((s[0] + 0.4) / (s[1] + 1.0)).clamp(0.01, 0.995)
    }

    /// Next byte of `src` after an exact prefix match with `typed`.
    fn prefix_next(src: &[u8], typed: &[u8]) -> Option<u8> {
        let k = typed.len();
        (src.len() >= k && &src[..k] == typed).then(|| if k < src.len() { src[k] } else { b']' })
    }

    /// Next byte of `src` after the longest suffix of `typed` (2..=8 bytes)
    /// found in `src`, with that length.
    fn resync_next(src: &[u8], typed: &[u8]) -> Option<(u8, usize)> {
        let k = typed.len();
        for l in (2..=k.min(8)).rev() {
            let suf = &typed[k - l..];
            if let Some(j) = (l..=src.len()).rev().find(|&j| &src[j - l..j] == suf) {
                return Some((if j < src.len() { src[j] } else { b']' }, l));
            }
        }
        None
    }

    fn predict(&mut self) {
        self.preds.clear();
        self.active = false;
        self.ctx = [0, 0];
        let State::Title(start) = self.state else {
            return;
        };
        let typed = &self.line[start..];
        let k = typed.len();
        let kb = match k {
            0 => 0,
            1..=2 => 1,
            3..=5 => 2,
            6..=9 => 3,
            10..=15 => 4,
            _ => 5,
        };
        let cb = (self.code % CODE_BUCKETS as u64) as usize;
        let slot = |kind: usize, sub: usize| (kind * CODE_BUCKETS + cb) * SUBS + sub;
        let english = self
            .titles
            .get(self.block)
            .map(|t| t.as_slice())
            .unwrap_or(b"");
        let e = Self::prefix_next(english, typed);
        let p = self
            .block_titles
            .iter()
            .rev()
            .find_map(|t| Self::prefix_next(t, typed));
        let agree = (e.is_some() && e == p) as usize;
        if let Some(c) = e {
            self.preds.push((c, slot(0, kb * 2 + agree)));
        }
        if let Some(c) = p {
            self.preds.push((c, slot(1, kb * 2 + agree)));
        }
        if e.is_none()
            && let Some((c, l)) = Self::resync_next(english, typed)
        {
            self.preds
                .push((c, slot(2, l.min(8) * 2 + (p.is_some() as usize))));
        }
        if p.is_none()
            && let Some((c, l)) = self
                .block_titles
                .iter()
                .rev()
                .find_map(|t| Self::resync_next(t, typed))
        {
            self.preds
                .push((c, slot(3, l.min(8) * 2 + (e.is_some() as usize))));
        }
        let at = |t: &[u8], i: usize| t.get(i).copied().unwrap_or(0) as u64;
        let first = self.preds.first().map_or(0, |x| x.0 as u64);
        self.ctx = [
            hash2(
                hash2(self.code, at(english, k)),
                (at(english, k + 1) << 8) | typed.last().copied().unwrap_or(0) as u64,
            ),
            hash2(
                self.code ^ 0x5bd1e995,
                ((kb as u64) << 16) | (first << 8) | self.preds.len() as u64,
            ),
        ];
        if self.preds.is_empty() {
            return;
        }
        // Noisy-OR for predictors that agree, then scale distinct
        // candidates so that some mass is always left for other bytes.
        self.dist.clear();
        for i in 0..self.preds.len() {
            let (c, k) = self.preds[i];
            let pr = self.prob(k);
            match self.dist.cand.iter_mut().find(|x| x.0 == c) {
                Some(x) => x.1 = 1.0 - (1.0 - x.1) * (1.0 - pr),
                None => self.dist.cand.push((c, pr)),
            }
        }
        let used: f32 = self.dist.cand.iter().map(|c| c.1).sum();
        if used > 0.98 {
            for c in &mut self.dist.cand {
                c.1 *= 0.98 / used;
            }
        }
        let used: f32 = self.dist.cand.iter().map(|c| c.1).sum();
        self.dist.rest = (1.0 - used).max(0.002);
        self.active = true;
    }
}

impl SideModel for LangModel {
    fn update(&mut self, hist: &[u8]) {
        let b = *hist.last().unwrap();
        for &(c, k) in &self.preds {
            let s = &mut self.stats[k];
            s[0] = 0.998 * s[0] + if c == b { 1.0 } else { 0.0 };
            s[1] = 0.998 * s[1] + 1.0;
        }
        if b == b'\n' {
            if crate::enwik::find(&self.line, b"</text>").is_some() {
                self.block += 1;
                self.block_titles.clear();
            }
            self.line.clear();
            self.state = State::LineStart;
        } else {
            self.line.push(b);
            match self.state {
                State::LineStart if self.line == b"[[" => {
                    self.state = State::Code;
                    self.code = 0;
                }
                State::LineStart if self.line.len() >= 2 => self.state = State::After,
                State::Code if b == b':' => self.state = State::Title(self.line.len()),
                State::Code => self.code = hash2(self.code, b as u64),
                State::Title(start) if b == b']' => {
                    let t = self.line[start..self.line.len() - 1].to_vec();
                    self.block_titles.push(t);
                    self.state = State::After;
                }
                _ => {}
            }
        }
        self.predict();
    }

    fn dist(&self) -> Option<&ByteDist> {
        if self.active { Some(&self.dist) } else { None }
    }

    fn mix_ctx(&self) -> usize {
        match self.preds.first().map(|p| p.1 / (CODE_BUCKETS * SUBS)) {
            Some(0) => 3,
            Some(1) => 2,
            _ => 1,
        }
    }

    fn ctx(&self) -> [u64; 2] {
        self.ctx
    }
}
