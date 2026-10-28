//! A compact bitwise context-mixing model: the measuring instrument.
//!
//! Orders 1-6, 8 and 12, two word contexts, two line/column contexts for
//! line-structured records, a sparse context, a match model, a two-layer
//! logistic mixer and three APM (SSE) stages. It is roughly lpaq-class, far
//! weaker than the cmix + transformer stack that holds the record, which is
//! why every experiment reports the *difference* between two runs of this
//! same model: one without and one with a side model.
//!
//! A [`SideModel`] plugs in two ways: it can publish a distribution over the
//! next byte (turned into bit predictions here and fed to the mixer), and it
//! can publish up to two extra context hashes (fed through their own hashed
//! tables like any other context). Side models only ever see bytes that were
//! already coded, so whatever they predict, the decoder predicts too.

use crate::side::{ByteDist, SideModel};

// ---- logistic domain ------------------------------------------------------

const SQ_T: [i32; 33] = [
    1, 2, 3, 6, 10, 16, 27, 45, 73, 120, 194, 310, 488, 747, 1101, 1546, 2047, 2549, 2994, 3348,
    3607, 3785, 3901, 3975, 4022, 4050, 4068, 4079, 4085, 4089, 4092, 4093, 4094,
];

/// logistic(d / 256) as a 12-bit probability, clamped to 1..=4095.
pub const fn squash(d: i32) -> i32 {
    if d > 2047 {
        return 4095;
    }
    if d < -2047 {
        return 1;
    }
    let w = d & 127;
    let i = ((d >> 7) + 16) as usize;
    (SQ_T[i] * (128 - w) + SQ_T[i + 1] * w + 64) >> 7
}

const fn build_stretch() -> [i16; 4096] {
    let mut t = [0i16; 4096];
    let mut pi = 0usize;
    let mut x = -2047;
    while x <= 2047 {
        let v = squash(x) as usize;
        let mut j = pi;
        while j <= v {
            t[j] = x as i16;
            j += 1;
        }
        pi = v + 1;
        x += 1;
    }
    let mut j = pi;
    while j < 4096 {
        t[j] = 2047;
        j += 1;
    }
    t
}

static STRETCH: [i16; 4096] = build_stretch();

/// ln(p / (1 - p)) * 256 for a 12-bit probability.
#[inline]
pub fn stretch(p: u32) -> i32 {
    STRETCH[p as usize] as i32
}

#[inline]
fn logit12(p: u32) -> f32 {
    stretch(p) as f32 * (1.0 / 256.0)
}

/// Logistic function through the 12-bit squash table (plenty for mixing).
#[inline]
fn sigmoid(x: f32) -> f32 {
    squash((x * 256.0) as i32) as f32 * (1.0 / 4096.0)
}

/// Asks the kernel to back a large table with transparent huge pages, which
/// removes most TLB misses from the random table lookups. Best effort.
fn advise_huge<T>(v: &mut [T]) {
    #[cfg(target_os = "linux")]
    {
        unsafe extern "C" {
            fn madvise(addr: *mut std::ffi::c_void, len: usize, advice: i32) -> i32;
        }
        const MADV_HUGEPAGE: i32 = 14;
        let len = std::mem::size_of_val(v);
        let start = v.as_mut_ptr() as usize;
        let aligned = (start + 4095) & !4095;
        if len > (4 << 20) && aligned < start + len {
            unsafe {
                madvise(
                    aligned as *mut std::ffi::c_void,
                    start + len - aligned,
                    MADV_HUGEPAGE,
                );
            }
        }
    }
}

/// Clamps a probability in (0, 1) to the 12-bit coder domain.
#[inline]
pub fn p12(p: f32) -> u32 {
    ((p * 4096.0) as i32).clamp(1, 4095) as u32
}

// ---- adaptive probability slots -------------------------------------------
//
// A slot is a u32: a 22-bit probability that the next bit is 1, and a 10-bit
// hit count that sets the learning rate to 1 / (count + 1.5) until `limit`.

const fn build_recip() -> [u32; 1024] {
    let mut t = [0u32; 1024];
    let mut i = 0;
    while i < 1024 {
        t[i] = 131072 / (2 * i as u32 + 3);
        i += 1;
    }
    t
}

static RECIP: [u32; 1024] = build_recip();

const SLOT_INIT: u32 = 1 << 31;

#[inline]
fn slot_p(s: u32) -> u32 {
    (s >> 20).clamp(1, 4095)
}

#[inline]
fn slot_update(s: &mut u32, bit: u32, limit: u32) {
    let n = *s & 1023;
    let p = (*s >> 10) as i64;
    let target = if bit != 0 { (1i64 << 22) - 1 } else { 0 };
    let np = p + (((target - p) * RECIP[n as usize] as i64) >> 16);
    *s = ((np as u32) << 10) | if n < limit { n + 1 } else { n };
}

#[inline]
pub fn hash2(a: u64, b: u64) -> u64 {
    let x = (a.wrapping_mul(0x9E37_79B9_7F4A_7C15) ^ b).wrapping_mul(0xD6E8_FEB8_6659_FD93);
    x ^ (x >> 31)
}

#[inline]
fn prefetch<T>(p: *const T) {
    #[cfg(target_arch = "x86_64")]
    unsafe {
        use std::arch::x86_64::{_MM_HINT_T0, _mm_prefetch};
        _mm_prefetch::<_MM_HINT_T0>(p as *const i8);
    }
}

/// Hashed context table. Each 64-byte bucket holds a checksum and the 15
/// slots of one nibble's binary tree, so a context costs two cache misses
/// per byte. Lookups probe three neighbouring buckets and evict the least
/// used one.
struct HashTable {
    t: Vec<[u32; 16]>,
    mask: usize,
    limit: u32,
}

impl HashTable {
    fn new(bits: u32, limit: u32) -> Self {
        let mut t = vec![[0u32; 16]; 1 << bits];
        advise_huge(&mut t);
        HashTable {
            t,
            mask: (1 << bits) - 1,
            limit,
        }
    }

    #[inline]
    fn home(&self, h: u64) -> usize {
        (h >> 40) as usize & self.mask
    }

    #[inline]
    fn prefetch(&self, h: u64) {
        prefetch(self.t.as_ptr().wrapping_add(self.home(h)));
    }

    fn find(&mut self, h: u64) -> usize {
        let i = self.home(h);
        let chk = (h as u32) | 1;
        for k in 0..3 {
            if self.t[i ^ k][0] == chk {
                return i ^ k;
            }
        }
        let mut best = i;
        let mut best_n = u32::MAX;
        for k in 0..3 {
            let b = &self.t[i ^ k];
            if b[0] == 0 {
                best = i ^ k;
                break;
            }
            let n = b[1] & 1023;
            if n < best_n {
                best_n = n;
                best = i ^ k;
            }
        }
        let b = &mut self.t[best];
        b[0] = chk;
        for s in &mut b[1..] {
            *s = SLOT_INIT;
        }
        best
    }
}

// ---- match model ------------------------------------------------------------

const MATCH_MIN: usize = 6;

struct MatchModel {
    table: Vec<u32>,
    mask: usize,
    ptr: usize,
    len: usize,
    byte: u32,
    miss: bool,
    sm: Vec<u32>,
    ctx: usize,
}

impl MatchModel {
    fn new(bits: u32) -> Self {
        MatchModel {
            table: vec![0; 1 << bits],
            mask: (1 << bits) - 1,
            ptr: 0,
            len: 0,
            byte: 0,
            miss: false,
            sm: vec![SLOT_INIT; 64],
            ctx: 0,
        }
    }

    fn bucket(&self) -> usize {
        if self.len < 16 {
            self.len
        } else {
            (16 + ((self.len - 16) >> 3)).min(31)
        }
    }

    fn update_byte(&mut self, hist: &[u8]) {
        let n = hist.len();
        if self.len > 0 && hist[self.ptr] == hist[n - 1] {
            self.len += 1;
            self.ptr += 1;
        } else {
            self.len = 0;
        }
        if n >= MATCH_MIN {
            let mut h = 0u64;
            for &b in &hist[n - MATCH_MIN..] {
                h = hash2(h, b as u64 + 1);
            }
            let slot = (h >> 40) as usize & self.mask;
            if self.len == 0 {
                let cand = self.table[slot] as usize;
                if cand > 0 && cand < n {
                    let mut l = 0;
                    while l < 400 && l < cand && hist[cand - 1 - l] == hist[n - 1 - l] {
                        l += 1;
                    }
                    if l >= MATCH_MIN {
                        self.len = l;
                        self.ptr = cand;
                    }
                }
            }
            self.table[slot] = n as u32;
        }
        self.miss = false;
        if self.len > 0 {
            self.byte = hist[self.ptr] as u32;
        }
    }

    /// Logit input for the next bit, or 0 when there is no usable match.
    #[inline]
    fn input(&mut self, c0: u32, bpos: u32) -> f32 {
        if self.len == 0 || self.miss {
            return 0.0;
        }
        if ((self.byte | 256) >> (8 - bpos)) != c0 {
            self.miss = true;
            return 0.0;
        }
        let expect = (self.byte >> (7 - bpos)) & 1;
        self.ctx = self.bucket() * 2 + expect as usize;
        logit12(slot_p(self.sm[self.ctx]))
    }

    #[inline]
    fn update(&mut self, bit: u32) {
        if self.len > 0 && !self.miss {
            slot_update(&mut self.sm[self.ctx], bit, 1023);
        }
    }

    fn mix_ctx(&self) -> usize {
        if self.len == 0 || self.miss {
            0
        } else {
            1 + self.bucket().min(14)
        }
    }
}

// ---- mixer ------------------------------------------------------------------

/// Number of mixer inputs (padded; unused ones stay 0).
pub const N_IN: usize = 24;

struct Mixer<const N: usize> {
    w: Vec<[f32; N]>,
    sel: usize,
    p: f32,
    lr: f32,
}

impl<const N: usize> Mixer<N> {
    fn new(nsets: usize, lr: f32, init: f32) -> Self {
        Mixer {
            w: vec![[init; N]; nsets],
            sel: 0,
            p: 0.5,
            lr,
        }
    }

    #[inline]
    fn dot(&mut self, x: &[f32; N], sel: usize) -> f32 {
        self.sel = sel;
        let s = dot_n(&self.w[sel], x).clamp(-15.0, 15.0);
        self.p = sigmoid(s);
        s
    }

    #[inline]
    fn update(&mut self, x: &[f32; N], y: f32) {
        let e = (y - self.p) * self.lr;
        axpy_n(&mut self.w[self.sel], x, e);
    }
}

#[inline]
fn dot_n<const N: usize>(w: &[f32; N], x: &[f32; N]) -> f32 {
    #[cfg(all(
        target_arch = "x86_64",
        target_feature = "avx2",
        target_feature = "fma"
    ))]
    if N.is_multiple_of(8) {
        // SAFETY: the target features are enabled at compile time and every
        // load reads 8 floats inside the N-element arrays.
        unsafe {
            use std::arch::x86_64::*;
            let mut acc = _mm256_setzero_ps();
            for c in 0..N / 8 {
                let a = _mm256_loadu_ps(w.as_ptr().add(c * 8));
                let b = _mm256_loadu_ps(x.as_ptr().add(c * 8));
                acc = _mm256_fmadd_ps(a, b, acc);
            }
            let s = _mm_add_ps(_mm256_extractf128_ps(acc, 1), _mm256_castps256_ps128(acc));
            let s = _mm_hadd_ps(s, s);
            let s = _mm_hadd_ps(s, s);
            return _mm_cvtss_f32(s);
        }
    }
    let mut s = 0.0f32;
    for i in 0..N {
        s += w[i] * x[i];
    }
    s
}

#[inline]
fn axpy_n<const N: usize>(w: &mut [f32; N], x: &[f32; N], e: f32) {
    #[cfg(all(
        target_arch = "x86_64",
        target_feature = "avx2",
        target_feature = "fma"
    ))]
    if N.is_multiple_of(8) {
        // SAFETY: as in dot_n.
        unsafe {
            use std::arch::x86_64::*;
            let ev = _mm256_set1_ps(e);
            for c in 0..N / 8 {
                let pw = w.as_mut_ptr().add(c * 8);
                let b = _mm256_loadu_ps(x.as_ptr().add(c * 8));
                _mm256_storeu_ps(pw, _mm256_fmadd_ps(ev, b, _mm256_loadu_ps(pw)));
            }
            return;
        }
    }
    for i in 0..N {
        w[i] += e * x[i];
    }
}

// ---- APM / SSE ----------------------------------------------------------------

struct Apm {
    t: Vec<u16>,
    idx: usize,
    rate: u32,
}

impl Apm {
    fn new(n: usize, rate: u32) -> Self {
        let mut t = vec![0u16; n * 33];
        for i in 0..n {
            for j in 0..33 {
                t[i * 33 + j] = (squash((j as i32 - 16) * 128) * 16) as u16;
            }
        }
        Apm { t, idx: 0, rate }
    }

    #[inline]
    fn pp(&mut self, pr: u32, cx: usize) -> u32 {
        let s = (stretch(pr) + 2048) as u32;
        let lo = (s >> 7) as usize;
        let w = s & 127;
        let base = cx * 33 + lo;
        self.idx = base + (w >> 6) as usize;
        ((self.t[base] as u32 * (128 - w) + self.t[base + 1] as u32 * w) >> 11).clamp(1, 4095)
    }

    #[inline]
    fn update(&mut self, y: u32) {
        let g = ((y << 16) + (y << self.rate)) as i32 - (y + y) as i32;
        let v = self.t[self.idx] as i32;
        self.t[self.idx] = (v + ((g - v) >> self.rate)) as u16;
    }
}

// ---- the model ----------------------------------------------------------------

/// Hashed byte contexts (see [`Model::byte_contexts`]).
const N_HASHED: usize = 12;
/// Extra hashed contexts a side model may publish.
const N_SIDE_CTX: usize = 2;
const N_TABLES: usize = N_HASHED + N_SIDE_CTX;

// Input slots.
const IN_O0: usize = N_TABLES;
const IN_O1: usize = N_TABLES + 1;
const IN_MATCH: usize = N_TABLES + 2;
const IN_SIDE: usize = N_TABLES + 3;
const IN_SIDE_CONF: usize = N_TABLES + 4;
const IN_BIAS: usize = N_TABLES + 5;
const _: () = assert!(IN_BIAS < N_IN);

/// Tunables that matter for speed and memory.
#[derive(Clone, Copy, Debug)]
pub struct Config {
    /// log2 of the number of 64-byte buckets per hashed context.
    pub table_bits: u32,
}

impl Default for Config {
    fn default() -> Self {
        Config { table_bits: 20 }
    }
}

// The raw bucket pointers target heap buffers owned by the model itself.
unsafe impl Send for Model {}

pub struct Model {
    tabs: Vec<HashTable>,
    ctx: [u64; N_TABLES],
    /// Current bucket of every table; inactive tables point at `dummy`,
    /// which is reset at every nibble so it always predicts 1/2.
    bucket: [*mut [u32; 16]; N_TABLES],
    dummy: Box<[[u32; 16]; N_TABLES]>,
    active: [bool; N_TABLES],
    o0: Vec<u32>,
    o1: Vec<u32>,
    mm: MatchModel,
    m_match: Mixer<N_IN>,
    m_c0: Mixer<N_IN>,
    m_c1: Mixer<N_IN>,
    m_fin: Mixer<4>,
    apm_c0: Apm,
    apm_c1: Apm,
    apm_side: Apm,
    x: [f32; N_IN],
    xf: [f32; 4],
    c0: u32,
    bpos: u32,
    c8: u64,
    word: u64,
    word1: u64,
    line_hash: u64,
    line_start: usize,
    prev_line_start: usize,
    prev_line_len: usize,
    pub hist: Vec<u8>,
    side: Option<Box<dyn SideModel>>,
    side_cand: Vec<(u32, f32)>,
    side_rest: f32,
    side_on: bool,
    side_mix: usize,
    pr: u32,
}

impl Model {
    pub fn new(cfg: Config, side: Option<Box<dyn SideModel>>) -> Self {
        let mut tabs = Vec::with_capacity(N_TABLES);
        // Low orders see many hits per context and want slow, stable rates;
        // high orders and records adapt faster.
        let limits = [255, 255, 127, 127, 127, 127, 127, 255, 127, 255, 255, 255];
        for &l in &limits {
            tabs.push(HashTable::new(cfg.table_bits, l));
        }
        for _ in 0..N_SIDE_CTX {
            tabs.push(HashTable::new(
                cfg.table_bits.saturating_sub(2).max(16),
                255,
            ));
        }
        let mut m = Model {
            tabs,
            ctx: [0; N_TABLES],
            bucket: [std::ptr::null_mut(); N_TABLES],
            dummy: Box::new([[SLOT_INIT; 16]; N_TABLES]),
            active: [false; N_TABLES],
            o0: vec![SLOT_INIT; 256],
            o1: vec![SLOT_INIT; 1 << 16],
            mm: MatchModel::new(22),
            m_match: Mixer::new(64 * 8, 0.002, 0.15),
            m_c0: Mixer::new(256, 0.002, 0.15),
            m_c1: Mixer::new(16 * 256, 0.002, 0.15),
            m_fin: Mixer::new(16 * 8, 0.0015, 0.66),
            apm_c0: Apm::new(256, 7),
            apm_c1: Apm::new(1 << 16, 7),
            apm_side: Apm::new(16 * 256, 7),
            x: [0.0; N_IN],
            xf: [0.0; 4],
            c0: 1,
            bpos: 0,
            c8: 0,
            word: 0,
            word1: 0,
            line_hash: 0,
            line_start: 0,
            prev_line_start: 0,
            prev_line_len: 0,
            hist: Vec::new(),
            side,
            side_cand: Vec::with_capacity(32),
            side_rest: 0.0,
            side_on: false,
            side_mix: 0,
            pr: 2048,
        };
        m.start_byte();
        m.predict();
        m
    }

    /// Probability (12-bit) that the next bit is 1.
    #[inline]
    pub fn p(&self) -> u32 {
        self.pr
    }

    /// The hashed byte contexts, computed after every byte.
    fn byte_contexts(&self) -> [u64; N_HASHED] {
        let c = self.c8;
        let n = self.hist.len();
        let c1 = c & 0xff;
        let mut o12 = 0u64;
        for &b in &self.hist[n.saturating_sub(12)..] {
            o12 = hash2(o12, b as u64);
        }
        let col = (n - self.line_start) as u64;
        let above = if (col as usize) < self.prev_line_len {
            self.hist[self.prev_line_start + col as usize] as u64
        } else {
            0
        };
        [
            hash2(1, c & 0xffff),
            hash2(2, c & 0xff_ffff),
            hash2(3, c & 0xffff_ffff),
            hash2(4, c & 0xff_ffff_ffff),
            hash2(5, c & 0xffff_ffff_ffff),
            hash2(6, c),
            hash2(7, o12),
            hash2(
                8,
                if self.word != 0 {
                    self.word
                } else {
                    hash2(self.word1, c1)
                },
            ),
            hash2(9, hash2(self.word, self.word1)),
            hash2(10, self.line_hash),
            hash2(11, (above << 16) | (col.min(255) << 8) | c1),
            hash2(12, (c >> 8) & 0xffff),
        ]
    }

    fn start_byte(&mut self) {
        let hashed = self.byte_contexts();
        self.ctx[..N_HASHED].copy_from_slice(&hashed);
        self.active[..N_HASHED].fill(true);
        let side = self.side.take();
        let (side_ctx, mix) = match &side {
            Some(s) => (s.ctx(), s.mix_ctx()),
            None => ([0; N_SIDE_CTX], 0),
        };
        for (k, &c) in side_ctx.iter().enumerate() {
            self.active[N_HASHED + k] = c != 0;
            self.ctx[N_HASHED + k] = hash2(13 + k as u64, c);
        }
        self.load_side(side.as_ref().and_then(|s| s.dist()));
        self.side = side;
        self.side_mix = mix.min(15);
        for i in 0..N_TABLES {
            if self.active[i] {
                self.tabs[i].prefetch(self.ctx[i]);
            }
        }
        for i in 0..N_TABLES {
            self.bucket[i] = self.bucket_for(i, self.ctx[i]);
        }
    }

    fn bucket_for(&mut self, i: usize, h: u64) -> *mut [u32; 16] {
        if self.active[i] {
            let j = self.tabs[i].find(h);
            &mut self.tabs[i].t[j]
        } else {
            self.dummy[i] = [SLOT_INIT; 16];
            &mut self.dummy[i]
        }
    }

    fn load_side(&mut self, dist: Option<&ByteDist>) {
        self.side_cand.clear();
        self.side_on = false;
        if let Some(d) = dist {
            self.side_on = true;
            let mut seen = [false; 256];
            for &(b, p) in &d.cand {
                if p > 0.0 && !seen[b as usize] {
                    seen[b as usize] = true;
                    self.side_cand.push((b as u32, p));
                }
            }
            let others = 256 - self.side_cand.len();
            self.side_rest = if others > 0 {
                d.rest.max(1e-9) / others as f32
            } else {
                0.0
            };
        }
    }

    fn nibble_buckets(&mut self) {
        for i in 0..N_TABLES {
            if self.active[i] {
                let h = hash2(self.ctx[i], self.c0 as u64);
                self.tabs[i].prefetch(h);
            }
        }
        for i in 0..N_TABLES {
            let h = hash2(self.ctx[i], self.c0 as u64);
            self.bucket[i] = self.bucket_for(i, h);
        }
    }

    #[inline]
    fn node(&self) -> usize {
        if self.bpos < 4 {
            self.c0 as usize
        } else {
            let k = self.bpos - 4;
            ((1 << k) | (self.c0 & ((1 << k) - 1))) as usize
        }
    }

    /// Side model's probability that the next bit is 1, if it has an opinion
    /// consistent with the bits of this byte seen so far.
    #[inline]
    fn side_p(&self) -> Option<f32> {
        if !self.side_on {
            return None;
        }
        let shift = 8 - self.bpos;
        let (mut tot, mut ones) = (0.0f32, 0.0f32);
        let (mut nc, mut nc1) = (0u32, 0u32);
        for &(b, p) in &self.side_cand {
            if (b | 256) >> shift == self.c0 {
                tot += p;
                nc += 1;
                if (b >> (shift - 1)) & 1 == 1 {
                    ones += p;
                    nc1 += 1;
                }
            }
        }
        let rest_all = (1u32 << shift) - nc;
        let rest_one = (1u32 << (shift - 1)) - nc1;
        tot += self.side_rest * rest_all as f32;
        ones += self.side_rest * rest_one as f32;
        if tot <= 0.0 {
            return None;
        }
        Some((ones / tot).clamp(1e-6, 1.0 - 1e-6))
    }

    fn predict(&mut self) {
        let node = self.node() & 15;
        for i in 0..N_TABLES {
            // SAFETY: bucket pointers always point into a live table or the
            // dummy buckets, which never move while the model exists.
            self.x[i] = logit12(slot_p(unsafe { (*self.bucket[i])[node] }));
        }
        self.x[IN_O0] = logit12(slot_p(self.o0[self.c0 as usize]));
        let c1 = (self.c8 & 0xff) as usize;
        self.x[IN_O1] = logit12(slot_p(self.o1[(c1 << 8) | self.c0 as usize]));
        self.x[IN_MATCH] = self.mm.input(self.c0, self.bpos);
        let sp = self.side_p();
        let (xs, conf) = match sp {
            Some(p) => {
                let l = (p / (1.0 - p)).ln().clamp(-12.0, 12.0);
                (
                    l,
                    if l.abs() > 6.0 {
                        3
                    } else if l.abs() > 3.0 {
                        2
                    } else {
                        1
                    },
                )
            }
            None => (0.0, 0),
        };
        self.x[IN_SIDE] = xs;
        self.x[IN_SIDE_CONF] = xs * 0.25;
        self.x[IN_BIAS] = 0.25;

        let side_sel = if sp.is_some() {
            self.side_mix.clamp(1, 3) * 4 + conf
        } else {
            0
        };
        let s0 = self
            .m_match
            .dot(&self.x, self.mm.mix_ctx() * 8 + self.bpos as usize);
        let s1 = self.m_c0.dot(&self.x, self.c0 as usize);
        let s2 = self.m_c1.dot(&self.x, side_sel * 256 + c1);
        self.xf = [s0 * 0.5, s1 * 0.5, s2 * 0.5, 0.25];
        let sf = self.m_fin.dot(&self.xf, side_sel * 8 + self.bpos as usize);
        let pf = p12(sigmoid(sf));
        let a1 = self.apm_c0.pp(pf, self.c0 as usize);
        let a2 = self.apm_c1.pp(pf, (c1 << 8) | self.c0 as usize);
        let a3 = self.apm_side.pp(pf, side_sel * 256 + self.c0 as usize);
        let p = if sp.is_some() {
            (pf + a1 + a2 + a3 * 5 + 4) >> 3
        } else {
            (2 * pf + a1 + 3 * a2 + 2 * a3 + 4) >> 3
        };
        self.pr = p.clamp(1, 4095);
    }

    /// Feeds the actual bit and prepares the prediction for the next one.
    pub fn update(&mut self, bit: u32) {
        let node = self.node() & 15;
        for i in 0..N_TABLES {
            let lim = self.tabs[i].limit;
            // SAFETY: see predict().
            slot_update(unsafe { &mut (*self.bucket[i])[node] }, bit, lim);
        }
        slot_update(&mut self.o0[self.c0 as usize], bit, 1023);
        let c1 = (self.c8 & 0xff) as usize;
        slot_update(&mut self.o1[(c1 << 8) | self.c0 as usize], bit, 1023);
        self.mm.update(bit);
        let y = bit as f32;
        self.m_match.update(&self.x, y);
        self.m_c0.update(&self.x, y);
        self.m_c1.update(&self.x, y);
        self.m_fin.update(&self.xf, y);
        self.apm_c0.update(bit);
        self.apm_c1.update(bit);
        self.apm_side.update(bit);

        self.c0 = (self.c0 << 1) | bit;
        self.bpos += 1;
        if self.bpos == 8 {
            let b = (self.c0 & 0xff) as u8;
            self.end_byte(b);
            self.c0 = 1;
            self.bpos = 0;
            self.start_byte();
        } else if self.bpos == 4 {
            self.nibble_buckets();
        }
        self.predict();
    }

    fn end_byte(&mut self, b: u8) {
        self.hist.push(b);
        self.c8 = (self.c8 << 8) | b as u64;
        let is_letter = b.is_ascii_alphabetic() || b >= 128;
        if is_letter {
            self.word = hash2(self.word, b.to_ascii_lowercase() as u64);
        } else if self.word != 0 {
            self.word1 = self.word;
            self.word = 0;
        }
        if b == b'\n' {
            self.prev_line_start = self.line_start;
            self.prev_line_len = self.hist.len() - self.line_start;
            self.line_start = self.hist.len();
            self.line_hash = 0;
        } else {
            self.line_hash = hash2(self.line_hash, b as u64);
        }
        self.mm.update_byte(&self.hist);
        if let Some(s) = self.side.as_mut() {
            s.update(&self.hist);
        }
    }
}
