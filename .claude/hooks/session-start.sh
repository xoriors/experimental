#!/bin/bash
set -euo pipefail

# Run installs in the background so the session is interactive immediately.
# 5-minute ceiling to cover plugin clone + pnpm install on cold containers.
echo '{"async": true, "asyncTimeout": 300000}'

# Only run in Claude Code on the web (ephemeral remote containers).
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
	exit 0
fi

: "${CLAUDE_PROJECT_DIR:?CLAUDE_PROJECT_DIR must be set}"

# NOTE: We intentionally do NOT auto-install third-party Claude plugins here.
# Auto-installing `vercel/vercel-plugin` on every remote session is a latent
# supply-chain exposure (namespace squat / upstream compromise would run on
# every cold container). If you need the plugin in a remote session, install
# it manually once with a pinned reference, e.g.:
#     npx plugins add vercel/vercel-plugin@<commit-sha>

# Pre-install weather-voodoo dependencies so dev/test/build are ready.
if [ -f "$CLAUDE_PROJECT_DIR/weather-voodoo/package.json" ]; then
	echo "[session-start] Installing weather-voodoo dependencies..."
	cd "$CLAUDE_PROJECT_DIR/weather-voodoo"
	pnpm install --prefer-offline --reporter=append-only
fi

echo "[session-start] Done."
