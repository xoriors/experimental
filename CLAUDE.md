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

### llm-git-conflict-resolve — working prototype

LLM-assisted git merge-conflict resolution driven by semantic intent (commit messages + three-way diff) rather than textual diffs. Python 3 stdlib only.

- Core tool: `python3 skill/git_tools.py {list|extract <file>|verify <file>}` — JSON output. `list` parses `git status --porcelain` for conflicts, `extract` pulls base/local/remote (`git show :1: :2: :3:`) plus commit intent, `verify` AST-checks Python syntax.
- `skill/instructions.md` is the Claude Code skill prompt defining the `scan` / `resolve <file>` / `apply` workflow.
- Demo conflict repos: `make rename`, `make logic`; clean up with `make clean`.

### ice-cube-simulator — working demo

Single-file, dependency-free canvas simulator (`ice-cube-simulator/index.html`) of why ice floats and how it melts: draggable buoyancy tank (91.7 % / 8.3 % split), hexagonal-lattice vs liquid molecular views tied to the melt animation, exact densities (ice Ih 0.9167 vs water 0.9998 g/cm³ at 0 °C). Open the file directly — no build step. The physics constants are load-bearing and documented in its README; keep them exact if you touch it.

### screen-narrator-d1 — working prototype

Tests Liquid AI's d1-ultra decision model as the "should I announce this?" gate of a screen narrator for blind users. TypeScript on Node 22 with pnpm. The README has the design, the quick start and the first results.

- Pipeline: `pnpm capture` (Playwright renders `fixtures/*.html` into before/after pairs, written to `data/pairs/index.json`), then `pnpm bench` (backends × pairs, written to `runs/<id>/results.json`), then `pnpm report`. `pnpm live` is the screen-sharing page that speaks. `pnpm test`, `pnpm typecheck`.
- `src/types.ts`, `src/questions.ts` and `src/policy.ts` are the shared contracts. Every backend derives its fields from the question set, so a new question key needs no backend edits; map it onto `Prediction` in `toPrediction` (`src/backends/liquid.ts`). Claude settings and pricing live only in `src/anthropic.ts`.
- `pnpm bench` spends real money on paid backends (Liquid costs cents; the Claude `vlm` backend costs more). Run `--dry-run` first, then `--limit`. Answers are cached in `runs/cache/`.
- Published results: [screen-narrator-d1.vercel.app](https://screen-narrator-d1.vercel.app) (Vercel team "xorio's projects"). To update it: `pnpm site [runId]` builds `public/` (the report + its screenshots), then `vercel deploy --prod --yes` **from inside `screen-narrator-d1/`**, where `.vercel/` links the project. `.vercelignore` uploads only `public/` and `vercel.json`, so no source, `.env`, `data/` or `runs/` leaves the machine.
- `.env` holds `LIQUID_API_KEY` and is gitignored. A hook blocks any Bash command that names `.env`; `src/env.ts` loads it.

### hutter-prize — research + Rust workbench

Ideas for beating the Hutter Prize record (enwik9; record 100,424,672 bytes by fx2-cmix-T, July 2026), with a dependency-free Rust crate (`hutter-lab`) that measures them. The README is the deliverable: ranked ideas, measured gains, transfer estimates and a plan.

- `cargo build --release`, `cargo test --release`, `cargo clippy --release` (kept warning-free). Needs Rust 1.88+. `.cargo/config.toml` sets `target-cpu=native` for the AVX2/FMA mixer.
- Experiments need `enwik9` (not in the repo) and, for the record holder's article order, `new_article_order` from the fx2-cmix-T repo (GPL, deliberately not vendored). `hutter-lab header|lang|census <enwik9> [--order FILE] [--verify]` prints the README's tables. The default `--table-bits 20` produced every published number; keep it if you re-run them.
- `src/cm.rs` is the proxy context-mixing model; `src/side/*` are the side models (`SideModel` trait: a next-byte distribution plus optional context hashes, fed only coded bytes); `src/transform.rs` holds the reversible transforms. A side model must stay strictly causal: `--verify` encodes, decodes and compares.
- Third-party compressors (fx2-cmix-T, cmix-lex, cmix-obias) were read, never built or run.

### ansible — working infra example

Tutorial-scale Ansible + Docker playground: one container runs Apache, another runs the playbook against it. Run with `docker-compose up --build` from `ansible/`.

### Idea / planning docs only (no code)

- **llm-password-reset** — concept for semantic ("fuzzy") password reset via LLM embeddings instead of exact security-question answers. README only.
- **llm-linter** — roadmap for using LLMs as static analyzers (prompts → skills → MCP → CI). README only.
- **AI-agents-delegate-actions** — design notes on reducing MCP context bloat via a tool-search/sub-agent proxy pattern. README only.
- **generative-ui**, **n8n** — placeholder link dumps / empty scratch spaces.
