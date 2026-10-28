//! Binary arithmetic coder (carry-less, 32-bit, lpaq style) and the three ways
//! experiments drive a model: measure, encode, decode.

use crate::cm::Model;

pub struct Encoder {
    x1: u32,
    x2: u32,
    out: Vec<u8>,
}

impl Default for Encoder {
    fn default() -> Self {
        Encoder {
            x1: 0,
            x2: u32::MAX,
            out: Vec::new(),
        }
    }
}

impl Encoder {
    /// Codes `bit` given P(bit = 1) = p / 4096.
    #[inline]
    pub fn encode(&mut self, bit: u32, p: u32) {
        let xmid = self.x1 + ((((self.x2 - self.x1) as u64) * p as u64) >> 12) as u32;
        if bit != 0 {
            self.x2 = xmid;
        } else {
            self.x1 = xmid + 1;
        }
        while (self.x1 ^ self.x2) & 0xff00_0000 == 0 {
            self.out.push((self.x2 >> 24) as u8);
            self.x1 <<= 8;
            self.x2 = (self.x2 << 8) | 255;
        }
    }

    pub fn finish(mut self) -> Vec<u8> {
        for _ in 0..4 {
            self.out.push((self.x1 >> 24) as u8);
            self.x1 <<= 8;
        }
        self.out
    }
}

pub struct Decoder<'a> {
    x1: u32,
    x2: u32,
    x: u32,
    buf: &'a [u8],
    pos: usize,
}

impl<'a> Decoder<'a> {
    pub fn new(buf: &'a [u8]) -> Self {
        let mut d = Decoder {
            x1: 0,
            x2: u32::MAX,
            x: 0,
            buf,
            pos: 0,
        };
        for _ in 0..4 {
            d.x = (d.x << 8) | d.next() as u32;
        }
        d
    }

    #[inline]
    fn next(&mut self) -> u8 {
        let b = self.buf.get(self.pos).copied().unwrap_or(0);
        self.pos += 1;
        b
    }

    #[inline]
    pub fn decode(&mut self, p: u32) -> u32 {
        let xmid = self.x1 + ((((self.x2 - self.x1) as u64) * p as u64) >> 12) as u32;
        let bit = (self.x <= xmid) as u32;
        if bit != 0 {
            self.x2 = xmid;
        } else {
            self.x1 = xmid + 1;
        }
        while (self.x1 ^ self.x2) & 0xff00_0000 == 0 {
            self.x1 <<= 8;
            self.x2 = (self.x2 << 8) | 255;
            self.x = (self.x << 8) | self.next() as u32;
        }
        bit
    }
}

/// Ideal code length of `data` under `model`, in bits, optionally recording
/// the cost of every byte.
pub fn measure(data: &[u8], model: &mut Model, mut per_byte: Option<&mut Vec<f32>>) -> f64 {
    let mut total = 0.0f64;
    for &b in data {
        let mut cost = 0.0f64;
        for i in (0..8).rev() {
            let bit = ((b >> i) & 1) as u32;
            let p = model.p() as f64 / 4096.0;
            cost -= if bit != 0 { p.log2() } else { (1.0 - p).log2() };
            model.update(bit);
        }
        total += cost;
        if let Some(v) = per_byte.as_deref_mut() {
            v.push(cost as f32);
        }
    }
    total
}

pub fn encode(data: &[u8], model: &mut Model) -> Vec<u8> {
    let mut enc = Encoder::default();
    for &b in data {
        for i in (0..8).rev() {
            let bit = ((b >> i) & 1) as u32;
            enc.encode(bit, model.p());
            model.update(bit);
        }
    }
    enc.finish()
}

pub fn decode(buf: &[u8], len: usize, model: &mut Model) -> Vec<u8> {
    let mut dec = Decoder::new(buf);
    let mut out = Vec::with_capacity(len);
    for _ in 0..len {
        let mut c = 0u32;
        for _ in 0..8 {
            let bit = dec.decode(model.p());
            model.update(bit);
            c = (c << 1) | bit;
        }
        out.push(c as u8);
    }
    out
}
