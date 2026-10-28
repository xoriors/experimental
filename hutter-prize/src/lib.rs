//! Measurement workbench for Hutter Prize ideas.
//!
//! * [`cm`]: a compact context-mixing model, the measuring instrument.
//! * [`coder`]: arithmetic coder and measurement loops.
//! * [`side`]: side models that encode knowledge about enwik9.
//! * [`enwik`]: page parser, the record holder's article order and its PHDA9 stream split.
//! * [`report`]: runs a stream with and without a side model and attributes the bits.
//! * [`transform`]: reversible stream rewrites, the cheapest way to deploy two of the ideas.

pub mod cm;
pub mod coder;
pub mod enwik;
pub mod report;
pub mod side;
pub mod transform;
