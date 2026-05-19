#!/bin/bash
set -euo pipefail

# Only run in Claude Code on the web (ephemeral remote containers).
# Locally, install once with: npx plugins add vercel/vercel-plugin
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
	exit 0
fi

# 1. Install the Vercel plugin into ~/.claude/plugins via the Claude marketplace.
#    Idempotent: the installer skips work if already registered. `printf 'y\n'`
#    answers the interactive "Install? [Y/n]" prompt without piping `yes`
#    (which would cause SIGPIPE under pipefail).
echo "[session-start] Ensuring Vercel plugin is installed..."
if ! printf 'y\n' | npx --yes plugins add vercel/vercel-plugin; then
	echo "[session-start] Vercel plugin install failed; continuing without it." >&2
fi

# 2. Pre-install weather-prediction dependencies so dev/test/build are ready.
if [ -f "$CLAUDE_PROJECT_DIR/weather-prediction/package.json" ]; then
	echo "[session-start] Installing weather-prediction dependencies..."
	cd "$CLAUDE_PROJECT_DIR/weather-prediction"
	pnpm install --prefer-offline --reporter=append-only
fi

echo "[session-start] Done."
