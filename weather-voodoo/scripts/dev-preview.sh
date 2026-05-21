#!/bin/bash
# Build the app with a unique build ID, run vitest + Playwright e2e against
# the production build, then deploy a Vercel preview and emit a bypass URL
# the project owner can click to test (avoids Vercel SSO interstitial).
#
# Requirements:
#   - `vercel login` already done in this environment
#   - `.vercel/project.json` present (created by `vercel link`)
#
# Skip the Vercel step with NO_DEPLOY=1.
set -euo pipefail

cd "$(dirname "$0")/.."

BUILD_ID="${BUILD_ID:-$(date -u +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD 2>/dev/null || echo nogit)}"
PORT="${PORT:-4173}"

echo "==> Build ID: $BUILD_ID"
echo "$BUILD_ID" > static/build-id.txt

echo "==> Unit tests"
pnpm test

echo "==> Production build"
pnpm build

echo "==> Playwright e2e (boots its own preview server)"
PLAYWRIGHT_PORT="$PORT" pnpm test:e2e

if [ "${NO_DEPLOY:-0}" = "1" ] || [ ! -f .vercel/project.json ]; then
  echo
  echo "============================================================"
  echo " Build ID:   $BUILD_ID"
  echo " (skipping Vercel deploy — NO_DEPLOY set or project not linked)"
  echo "============================================================"
  exit 0
fi

echo "==> Vercel preview deploy"
vercel pull --yes --environment=preview >/dev/null 2>&1
vercel build >/dev/null
DEPLOY_OUT=$(vercel deploy --prebuilt 2>&1)
URL=$(echo "$DEPLOY_OUT" | grep -oE 'https://[a-z0-9-]+\.vercel\.app' | head -1 | sed 's#^https://##')
if [ -z "$URL" ]; then
  echo "Failed to parse deploy URL. Last 20 lines:"
  echo "$DEPLOY_OUT" | tail -20
  exit 1
fi

PROJECT_ID=$(python3 -c "import json; print(json.load(open('.vercel/project.json'))['projectId'])")
TEAM_ID=$(python3 -c "import json; print(json.load(open('.vercel/project.json'))['orgId'])")
TOKEN=$(python3 -c "import json; print(json.load(open('$HOME/.local/share/com.vercel.cli/auth.json'))['token'])")
BYPASS=$(curl -sf "https://api.vercel.com/v9/projects/$PROJECT_ID?teamId=$TEAM_ID" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import json, sys; d=json.load(sys.stdin); bp=d.get('protectionBypass') or {}; print(next(iter(bp.keys()), ''))" 2>/dev/null || echo "")

PUBLIC_URL="https://$URL/?x-vercel-protection-bypass=$BYPASS&x-vercel-set-bypass-cookie=true"

echo
echo "============================================================"
echo " Build ID:    $BUILD_ID"
echo " Vercel URL:  https://$URL"
echo " Test URL:    $PUBLIC_URL"
echo " (the test URL sets the bypass cookie so SSO is skipped)"
echo "============================================================"
