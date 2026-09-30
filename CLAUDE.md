# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This is **experimental** — a sandbox for experimental ideas and proofs of concept by xorio. It contains multiple independent sub-projects at very different maturity levels: one deployed app, a couple of working prototypes, and several idea/planning documents with **no code**. Check what actually exists in a sub-project before assuming an implementation is present.

## Sub-Projects

### weather-voodoo — deployed app (the flagship)

SvelteKit PWA with hour-by-hour fused weather forecasts for routes, waypoint trips, and fixed locations, plus trip-window scoring. Deployed on Vercel.

**It has its own `weather-voodoo/CLAUDE.md`** — commands, architecture, deploy pitfalls, and the mandatory i18n workflow live there. Read it before making any change in that directory.

### solar-eclipse-2026 — deployable app

SvelteKit site about the 12 August 2026 total solar eclipse, with an interactive sky simulator and a
map of the path of totality. Deploys to Vercel as fully prerendered static output.

Everything is computed at runtime from NASA's Besselian elements — there are no lookup tables — so
the maths in `src/lib/eclipse/` is load-bearing for every number on every page. `pnpm test` checks it
against published predictions (greatest eclipse, path width, gamma, and per-city durations); **run it
before touching anything in that directory.** Two conventions there are easy to get wrong and are
documented in the README: the ephemeris-meridian correction to `mu`, and the fact that NASA's quoted
"eclipse magnitude" for a central eclipse is the Moon/Sun diameter ratio rather than the standard
magnitude formula.

### formal-verification/tla-plus — working demos (Rust + Go, TLA+)

Two concurrent programs checked with the TLC model checker. Each has a buggy variant, a fixed variant, and TLA+ specs of both.
`rust-blocking-queue/` is a `Mutex`+`Condvar` queue, specified in plain TLA+ and bridged to the code by trace validation.
`go-worker-pool/` is a worker pool with `Submit` racing `Shutdown`, specified in PlusCal and bridged by counterexample replay through `testHook` variables.

- `make all` from `formal-verification/tla-plus/` runs both test suites, then every model. Needs Java 11+, Rust, Go 1.24.
- `tools/tla.sh` downloads a sha256-pinned `tla2tools.jar` (v1.7.4) into the gitignored `.tools/`, and `tools/tla.sh check` runs every `.cfg`.
- **Every `.cfg` declares `\* SPEC:` and `\* EXPECT:` headers**, and `check` fails when TLC's outcome differs, in either direction. Buggy designs, mutations and reachability probes are *expected* to fail. Keep those models failing: they are what shows the passing ones aren't vacuous.
- After editing a PlusCal spec, re-translate it with `tools/tla.sh pcal <spec>`. `make verify` runs `pcal-check` and fails on a stale translation.
- The READMEs quote observed TLC output and state counts. Re-run the models and update those numbers whenever you touch a spec.

### llm-git-conflict-resolve — working prototype

LLM-assisted git merge-conflict resolution driven by semantic intent (commit messages + three-way diff) rather than textual diffs. Python 3 stdlib only.

- Core tool: `python3 skill/git_tools.py {list|extract <file>|verify <file>}` — JSON output. `list` parses `git status --porcelain` for conflicts, `extract` pulls base/local/remote (`git show :1: :2: :3:`) plus commit intent, `verify` AST-checks Python syntax.
- `skill/instructions.md` is the Claude Code skill prompt defining the `scan` / `resolve <file>` / `apply` workflow.
- Demo conflict repos: `make rename`, `make logic`; clean up with `make clean`.

### ice-cube-simulator — working demo

Single-file, dependency-free canvas simulator (`ice-cube-simulator/index.html`) of why ice floats and how it melts: draggable buoyancy tank (91.7 % / 8.3 % split), hexagonal-lattice vs liquid molecular views tied to the melt animation, exact densities (ice Ih 0.9167 vs water 0.9998 g/cm³ at 0 °C). Open the file directly — no build step. The physics constants are load-bearing and documented in its README; keep them exact if you touch it.

### ansible — working infra example

Tutorial-scale Ansible + Docker playground: one container runs Apache, another runs the playbook against it. Run with `docker-compose up --build` from `ansible/`.

### Idea / planning docs only (no code)

- **llm-password-reset** — concept for semantic ("fuzzy") password reset via LLM embeddings instead of exact security-question answers. README only.
- **llm-linter** — roadmap for using LLMs as static analyzers (prompts → skills → MCP → CI). README only.
- **AI-agents-delegate-actions** — design notes on reducing MCP context bloat via a tool-search/sub-agent proxy pattern. README only.
- **generative-ui**, **n8n** — placeholder link dumps / empty scratch spaces.
