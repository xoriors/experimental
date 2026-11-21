//! `app-to-mcp-record` crate.

use thiserror::Error;

#[derive(Debug, Error)]
pub enum Error {
    #[error("not yet implemented: {0}")]
    Unimplemented(&'static str),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_displays_message() {
        let err = Error::Unimplemented("record");
        assert_eq!(err.to_string(), "not yet implemented: record");
    }
}
