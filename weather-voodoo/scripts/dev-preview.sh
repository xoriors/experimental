#!/bin/bash
# Build the app with a unique build ID, run vitest + Playwright e2e against
# the production build, and (when available) expose the preview through a
# Cloudflare Quick Tunnel so the change can be tested from any browser.
#
# When tunnel egress is blocked (some restricted environments block
# cloudflared's edge ports), the script still completes a full build + test
# pass and reports the local preview URL plus the build ID so the change
# can be verified from a Vercel preview deployment after `git push`.
set -euo pipefail

cd "$(dirname "$0")/.."

BUILD_ID="${BUILD_ID:-$(date -u +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD 2>/dev/null || echo nogit)}"
PORT="${PORT:-4173}"
LOG_DIR="/tmp/weather-voodoo-dev"
mkdir -p "$LOG_DIR"

echo "==> Build ID: $BUILD_ID"
echo "$BUILD_ID" > static/build-id.txt

echo "==> Unit tests"
pnpm test

echo "==> Production build"
pnpm build

echo "==> Playwright e2e (boots its own preview server)"
PLAYWRIGHT_PORT="$PORT" pnpm test:e2e

echo
echo "============================================================"
echo " Build ID:   $BUILD_ID"
echo " Local URL:  http://localhost:$PORT  (run 'pnpm preview' to serve)"
echo " Build tag:  /build-id.txt"
echo " To preview publicly: push the branch — Vercel auto-creates a"
echo " preview deployment URL for the commit, posted as a PR check."
echo "============================================================"
