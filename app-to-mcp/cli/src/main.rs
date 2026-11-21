use std::path::PathBuf;

use anyhow::Result;
use clap::{Parser, Subcommand};
use tracing::info;
use tracing_subscriber::EnvFilter;

#[derive(Debug, Parser)]
#[command(
    name = "app-to-mcp",
    about = "Show it an app once, get a typed MCP server for it."
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Record user actions in a web or desktop app into a trace.
    Record {
        /// Target URL or application identifier.
        target: String,
    },
    /// Compile a recorded trace into a versioned app spec.
    Compile {
        /// Path to the recorded trace file.
        trace: PathBuf,
    },
    /// Serve an app spec as an MCP server over stdio.
    Serve {
        /// Path to the YAML spec file.
        spec: PathBuf,
    },
    /// Validate an app spec and check for missing risk tiers or inline secrets.
    Lint {
        /// Path to the YAML spec file.
        spec: PathBuf,
    },
    /// Replay recorded traces against an app spec to verify endpoints.
    Test {
        /// Path to the YAML spec file.
        spec: PathBuf,
    },
}

fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let cli = Cli::parse();

    match cli.command {
        Command::Record { target } => info!(%target, "record: not yet implemented"),
        Command::Compile { trace } => info!(?trace, "compile: not yet implemented"),
        Command::Serve { spec } => info!(?spec, "serve: not yet implemented"),
        Command::Lint { spec } => info!(?spec, "lint: not yet implemented"),
        Command::Test { spec } => info!(?spec, "test: not yet implemented"),
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::CommandFactory;

    #[test]
    fn verify_cli() {
        Cli::command().debug_assert();
    }
}
