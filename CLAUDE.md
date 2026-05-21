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

## Development Notes

- The GUARD frontend is a Custom GPT (ChatGPT Agent) - not a traditional website
- Raw passphrases are never stored; only vector embeddings are persisted (zero-knowledge approach)
- The `guard_openai.yaml` file contains the OpenAPI schema for the Custom GPT actions
