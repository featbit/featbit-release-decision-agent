#!/usr/bin/env node
import { startServer } from "../server.js";

const DEFAULT_PORT = 3100;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_CORS = "https://www.featbit.ai,https://app.featbit.ai,https://featbit.ai,http://localhost:3000";
const DEFAULT_PERMISSION_MODE = "bypassPermissions";
const DEFAULT_SYNC_API_URL = "https://www.featbit.ai";

const args = process.argv.slice(2);

/**
 * Look up a flag value by any of the given names. Supports both
 * `--name value` and `--name=value`. Returns the first match or undefined.
 */
function parseFlag(names: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    for (const name of names) {
      if (arg === name) return args[i + 1];
      if (arg.startsWith(name + "=")) return arg.slice(name.length + 1);
    }
  }
  return undefined;
}

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
@featbit/experimentation-claude-code-connector

  Local bridge that exposes your Claude Code CLI to the FeatBit
  experimentation web app over Server-Sent Events.

USAGE
  npx @featbit/experimentation-claude-code-connector [options]

OPTIONS
  -t, --access-token <token>   Bearer token (fbat_...) the agent uses on every
                               /api/experiments/* call. Issue from the web UI:
                               Env Settings → Agent tokens → Issue token.
  --sync-api-url <url>         Base URL of the FeatBit web app
                               (default: ${DEFAULT_SYNC_API_URL}).
                               Use http://localhost:3000 for a local web.
  --port <port>                Listen port (default: ${DEFAULT_PORT}).
  --host <host>                Bind address (default: ${DEFAULT_HOST}, loopback).
  --cors-origins <list>        Comma-separated origins, or "*". Default:
                               ${DEFAULT_CORS}
  --permission-mode <mode>     SDK permission mode. One of:
                               default | acceptEdits | bypassPermissions | plan
                               (default: ${DEFAULT_PERMISSION_MODE}).
  -h, --help                   Show this help.

ENVIRONMENT VARIABLES
  Each flag has a corresponding env var. Flags take precedence; env vars are
  fallbacks (useful for systemd / Docker setups).

  --access-token       → ACCESS_TOKEN   (also FEATBIT_ACCESS_TOKEN, legacy)
  --sync-api-url       → SYNC_API_URL
  --port               → PORT
  --host               → HOST
  --cors-origins       → CORS_ORIGINS
  --permission-mode    → PERMISSION_MODE

REQUIREMENTS
  - Claude Code CLI installed and logged in (run \`claude\` once first)
  - Node.js >= 20

The connector listens on the loopback interface only, so the port is not
exposed to other devices on your network.
`);
  process.exit(0);
}

function parsePort(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > 65535) {
    console.error(`Invalid port "${raw}", falling back to ${fallback}`);
    return fallback;
  }
  return n;
}

function parseCors(raw: string | undefined): string | string[] {
  const value = raw ?? DEFAULT_CORS;
  if (value === "*") return "*";
  const list = value.split(",").map((s) => s.trim()).filter(Boolean);
  return list.length === 1 ? list[0] : list;
}

// Resolution order for every option: CLI flag > env var > default.
// Pass-through values (ACCESS_TOKEN, SYNC_API_URL, PERMISSION_MODE) are
// written into process.env so the spawned `claude` agent and the sync.ts
// child it later runs inherit them by normal env propagation.
const flagAccessToken = parseFlag(["--access-token", "-t"]);
const flagSyncApiUrl = parseFlag(["--sync-api-url"]);
const flagPermissionMode = parseFlag(["--permission-mode"]);

if (flagAccessToken) process.env.ACCESS_TOKEN = flagAccessToken;
if (flagSyncApiUrl) process.env.SYNC_API_URL = flagSyncApiUrl;
if (flagPermissionMode) process.env.PERMISSION_MODE = flagPermissionMode;

const port = parsePort(parseFlag(["--port"]) ?? process.env.PORT, DEFAULT_PORT);
const host = parseFlag(["--host"]) ?? process.env.HOST ?? DEFAULT_HOST;
const corsOrigins = parseCors(parseFlag(["--cors-origins"]) ?? process.env.CORS_ORIGINS);

startServer({ port, host, corsOrigins });
