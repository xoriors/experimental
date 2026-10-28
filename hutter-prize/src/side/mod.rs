//! Side models: small, data-aware predictors that plug into [`crate::cm::Model`].
//!
//! Each one encodes a piece of knowledge about enwik9 that neither a context
//! mixer nor a byte-level transformer can learn from local context alone:
//! revision ids are a global clock, interwiki links name the article's own
//! subject, census tables contain arithmetic. A side model sees exactly the
//! bytes already coded (plus side information the real decoder would already
//! hold), so the arithmetic decoder reproduces every prediction.

pub mod census;
pub mod header;
pub mod lang;
pub mod numfmt;

/// A distribution over the next byte: explicit candidates, and `rest`, the
/// mass spread uniformly over every byte not listed.
#[derive(Clone, Debug, Default)]
pub struct ByteDist {
    pub cand: Vec<(u8, f32)>,
    pub rest: f32,
}

impl ByteDist {
    pub fn clear(&mut self) {
        self.cand.clear();
        self.rest = 0.0;
    }

    /// Normalises the candidates to `1 - escape` and gives `escape` to `rest`.
    pub fn normalise(&mut self, escape: f32) {
        let tot: f32 = self.cand.iter().map(|c| c.1).sum();
        if tot > 0.0 {
            let k = (1.0 - escape) / tot;
            for c in &mut self.cand {
                c.1 *= k;
            }
            self.rest = escape;
        } else {
            self.rest = 1.0;
        }
    }
}

pub trait SideModel {
    /// Called after every coded byte; `hist` holds all bytes so far.
    fn update(&mut self, hist: &[u8]);
    /// Opinion about the next byte, if any.
    fn dist(&self) -> Option<&ByteDist>;
    /// Mixer-selection context while active, in 1..=3 (more confident = higher).
    fn mix_ctx(&self) -> usize {
        1
    }
    /// Up to two extra context hashes for the model's hashed tables (0 = none).
    fn ctx(&self) -> [u64; 2] {
        [0, 0]
    }
}
