# whatsapp-summary-agent

Reads **all** messages in a WhatsApp group and posts a once-a-day AI summary back
to the same group. Self-hosted, using [Baileys](https://github.com/WhiskeySockets/Baileys)
for WhatsApp and the **Anthropic API (direct API key)** for the summary.

```
WhatsApp group
   │  Baileys logged in as a dedicated bot number
   ▼
messages.upsert handler ──► SQLite (data/messages.db)   ← all day
   │
   ▼  daily at SUMMARY_CRON
Claude summarizes the day  ──►  sendMessage() back to the group
```

One always-on Node process does everything: listens, stores, and on a cron posts
the summary.

## ⚠️ Read this first

- **Unofficial protocol.** Baileys automates WhatsApp Web. This **violates WhatsApp's
  Terms of Service** and the number **can be banned**. Use a **dedicated secondary
  number**, never your personal one.
- **Consent.** You're storing and summarizing real people's messages and sending
  them to an LLM. Tell the group a bot is present.
- **Billing.** The Anthropic API key is billed **pay-as-you-go**, separate from any
  Claude.ai Pro/Max subscription. A daily Haiku summary costs **cents per month**.

## Prerequisites

- Node.js 20+
- A dedicated WhatsApp number on a phone you can scan a QR with
- An Anthropic API key from <https://console.anthropic.com>

## Setup

```bash
cd whatsapp-summary-agent
cp .env.example .env
#   → put your ANTHROPIC_API_KEY in .env
npm install
```

### 1. First run — link the device & find the group JID

```bash
npm run start
```

- A QR code prints in the terminal. Scan it: **WhatsApp → Linked devices → Link a device.**
  Credentials are saved to `auth/`, so you only scan once.
- With `GROUP_JID` still empty, every inbound group message logs its JID:
  ```
  [wa] message from group JID: 120363012345678901@g.us (set GROUP_JID to this)
  ```
  Send a test message in the target group, copy that `...@g.us` value into
  `GROUP_JID` in `.env`, and restart.

### 2. Test the summary path immediately (optional)

```bash
npm run summary:now
```

Connects, waits 8s, then summarizes today's captured messages and posts to the
group right away — no need to wait for the cron.

### 3. Run it for real

```bash
npm run start          # dev (tsx)
# or
npm run build && npm run serve   # compiled (dist/)
```

It captures messages continuously and posts a summary at `SUMMARY_CRON`
(default 20:00, in `TZ`).

## Configuration

All via `.env` (see `.env.example`):

| Var | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | **Required.** Anthropic API key (pay-as-you-go). |
| `SUMMARY_MODEL` | `claude-haiku-4-5` | Cheapest good option. `claude-sonnet-4-6` for nicer prose, `claude-opus-4-8` for best quality. |
| `GROUP_JID` | — | Target group, e.g. `...@g.us`. Discover it from the logs on first run. |
| `SUMMARY_CRON` | `0 20 * * *` | When to post (node-cron, 5 fields). |
| `TZ` | `Europe/Bucharest` | Timezone the cron and "today" boundary use. |
| `DB_PATH` | `./data/messages.db` | SQLite message store. |
| `AUTH_DIR` | `./auth` | Baileys credentials (scan QR once). |
| `RETENTION_DAYS` | `14` | Prune messages older than this. |
| `MAX_TRANSCRIPT_CHARS` | `40000` | Caps tokens sent on very busy days (keeps the most recent). |

## Run with Docker

```bash
cp .env.example .env   # set ANTHROPIC_API_KEY (+ GROUP_JID once known)

# First boot is interactive so you can scan the QR:
docker compose run --rm whatsapp-summary-agent
#   scan QR, note the group JID, Ctrl+C

# set GROUP_JID in .env, then run detached:
docker compose up -d --build
docker compose logs -f
```

`auth/` and `data/` are mounted as volumes, so the login and message history
survive restarts. `restart: unless-stopped` brings it back after crashes/reboots.

## How it works (files)

| File | Role |
|---|---|
| `src/index.ts` | Boot: start socket + schedule the cron. |
| `src/wa.ts` | Baileys connection, QR/auth, reconnect, message capture. |
| `src/store.ts` | SQLite: insert messages, query a day, prune old. |
| `src/summarize.ts` | Calls the Anthropic API to produce the summary. |
| `src/job.ts` | Daily: gather today's messages → summarize → post. |
| `src/config.ts` | Env loading/validation. |

## Notes & limitations

- **Text only.** Images/audio/stickers are skipped (image/video/document captions
  are captured). Extend `extractText()` in `src/wa.ts` if you want more.
- **Session loss.** If WhatsApp logs the device out, delete `auth/` and re-scan.
- **Library drift.** WhatsApp changes can break Baileys; pin the version and update
  occasionally.
- **"Today"** is local-midnight-to-now in `TZ`. Adjust `startOfTodayUnix()` in
  `src/job.ts` for a rolling 24h window instead.
