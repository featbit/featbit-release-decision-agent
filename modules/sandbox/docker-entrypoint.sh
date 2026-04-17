#!/bin/sh
set -e

# ── Validate required environment variable ────────────────────────────────────
if [ -z "${GLM_API_KEY}" ]; then
  echo "[entrypoint] ERROR: GLM_API_KEY is required." >&2
  echo "[entrypoint] Provide it with:  docker run -e GLM_API_KEY=<your-key> ..." >&2
  exit 1
fi

# ── Write user-level Claude Code settings (GLM backend) ───────────────────────
CLAUDE_DIR="${HOME}/.claude"
mkdir -p "${CLAUDE_DIR}"

# This file configures Claude Code CLI to route all API calls through GLM.
# ANTHROPIC_AUTH_TOKEN is the credential GLM expects in place of an Anthropic key.
# Model aliases map Claude model tiers to the nearest GLM equivalents.
cat > "${CLAUDE_DIR}/settings.json" << SETTINGS
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "${GLM_API_KEY}",
    "ANTHROPIC_BASE_URL": "https://open.bigmodel.cn/api/anthropic",
    "API_TIMEOUT_MS": "3000000",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "glm-4.7",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "glm-5-turbo",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "glm-5.1"
  }
}
SETTINGS

# Suppress the interactive first-run onboarding wizard
cat > "${HOME}/.claude.json" << ONBOARD
{
  "hasCompletedOnboarding": true
}
ONBOARD

echo "[entrypoint] Claude Code → GLM  (https://open.bigmodel.cn/api/anthropic)"
echo "[entrypoint] Models: haiku=glm-4.7  sonnet=glm-5-turbo  opus=glm-5.1"

# ── Hand off to the server process ────────────────────────────────────────────
exec "$@"
