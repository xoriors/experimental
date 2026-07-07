# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This is **experimental** — a sandbox for experimental ideas and proofs of concept by xorio. It contains multiple independent sub-projects at very different maturity levels: one deployed app, a couple of working prototypes, and several idea/planning documents with **no code**. Check what actually exists in a sub-project before assuming an implementation is present.

## Sub-Projects

### weather-voodoo — deployed app (the flagship)

SvelteKit PWA with hour-by-hour fused weather forecasts for routes, waypoint trips, and fixed locations, plus trip-window scoring. Deployed on Vercel.

**It has its own `weather-voodoo/CLAUDE.md`** — commands, architecture, deploy pitfalls, and the mandatory i18n workflow live there. Read it before making any change in that directory.

### llm-git-conflict-resolve — working prototype

LLM-assisted git merge-conflict resolution driven by semantic intent (commit messages + three-way diff) rather than textual diffs. Python 3 stdlib only.

- Core tool: `python3 skill/git_tools.py {list|extract <file>|verify <file>}` — JSON output. `list` parses `git status --porcelain` for conflicts, `extract` pulls base/local/remote (`git show :1: :2: :3:`) plus commit intent, `verify` AST-checks Python syntax.
- `skill/instructions.md` is the Claude Code skill prompt defining the `scan` / `resolve <file>` / `apply` workflow.
- Demo conflict repos: `make rename`, `make logic`; clean up with `make clean`.

### ansible — working infra example

Tutorial-scale Ansible + Docker playground: one container runs Apache, another runs the playbook against it. Run with `docker-compose up --build` from `ansible/`.

### Idea / planning docs only (no code)

- **llm-password-reset** — concept for semantic ("fuzzy") password reset via LLM embeddings instead of exact security-question answers. README only.
- **llm-linter** — roadmap for using LLMs as static analyzers (prompts → skills → MCP → CI). README only.
- **AI-agents-delegate-actions** — design notes on reducing MCP context bloat via a tool-search/sub-agent proxy pattern. README only.
- **generative-ui**, **n8n** — placeholder link dumps / empty scratch spaces.
