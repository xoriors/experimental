# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This is **experimental** - a sandbox for experimental ideas and proofs of concept by xorio. Contains multiple independent sub-projects that explore different concepts.

## Sub-Projects

### llm-password-reset (GUARD)
A semantic authentication system using LLM embeddings for "fuzzy" password reset. Users prove identity through meaning-based matching rather than exact string matching.

**Tech stack:** Python 3.12, FastAPI, SQLite, sentence-transformers (SBERT), bcrypt, PyTorch

**Run locally:**
```bash
cd llm-password-reset
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn guard_server:app --reload --port 8000
```

**Run with Docker:**
```bash
cd llm-password-reset
echo "NGROK_AUTHTOKEN=your_token" > .env
docker-compose up --build
```

**Key endpoints:**
- `GET /user/{user_id}` - Check user existence and lock status
- `POST /enroll` - Register user with password and semantic phrases
- `POST /verify` - Authenticate via password or semantic phrase matching
- `POST /update_account` - Update password after verification

**Architecture:**
- `guard_server.py` - Main FastAPI application with all endpoints
- Uses SBERT model `all-MiniLM-L6-v2` for embedding phrases (384-dimensional vectors)
- SQLite database (`guard_secure.db`) with tables: `users`, `phrases`, `auth_context`
- Verification thresholds: >=0.80 authorized, 0.60-0.80 ambiguous (one clarification allowed), <0.60 denied
- Account lockout after 3 failed attempts (10 min cooldown)

### llm-linter
Exploration of using LLMs as static code analyzers. Currently contains planning/approach documentation only.

### ansible
Infrastructure automation experiments with Ansible and Docker.

### weather-voodoo
SvelteKit app showing hour-by-hour fused weather forecasts for routes and fixed locations, with trip-window scoring.

**Tech stack:** SvelteKit (Svelte 5 runes), TypeScript, MapLibre GL, Vitest, Vercel adapter

**Run locally:**
```bash
cd weather-voodoo
pnpm install
pnpm dev
```

**Localization (i18n)** — required for any text-facing change:

- Source of truth dictionary: `weather-voodoo/src/lib/i18n/en.ts`. The exported `Dict` type defines the shape every locale must implement.
- Supported locales: English (`en`), Thai (`th`), Romanian (`ro`). Files: `src/lib/i18n/{en,th,ro}.ts`.
- Reactive locale state + `t(key, vars?)` helper: `src/lib/i18n/index.svelte.ts`.
- Locale is part of the URL state (`lng=` param) and is also persisted in localStorage (`wx-voodoo-locale`).
- Language switcher lives in the layout header: `src/lib/components/LanguageSwitcher.svelte`.

**When adding or changing any user-facing text:**

1. Add (or update) the key in `src/lib/i18n/en.ts` — extend the `Dict` type if it's a new key.
2. Add the equivalent translation in **every** other locale file (`th.ts`, `ro.ts`) — never leave keys English-only. TypeScript will fail the build if a locale is missing a key.
3. Use `t('your.key', { vars })` in the component instead of hardcoding strings. Interpolation uses `{name}` placeholders.
4. Strings inside `.ts` library helpers should be returned as **keys** or **structured data**, not pre-localized strings — let the component call `t()`.
5. Tooltips (`title=`), `aria-label`, placeholders, toast messages, document title, and error messages are user-facing too — translate them.

If you add a new locale, add it to `LOCALES` and `LOCALE_NAMES` in `src/lib/i18n/index.svelte.ts`, and to the `isLocale` predicate.

## Development Notes

- The GUARD frontend is a Custom GPT (ChatGPT Agent) - not a traditional website
- Raw passphrases are never stored; only vector embeddings are persisted (zero-knowledge approach)
- The `guard_openai.yaml` file contains the OpenAPI schema for the Custom GPT actions
