#!/usr/bin/env node
import { startServer } from "../server.js";

const DEFAULT_PORT = 3100;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_CORS = "https://app.featbit.ai,https://featbit.ai,http://localhost:3000";

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

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(`
@featbit/experimentation-claude-code-connector

  Local bridge that exposes your Claude Code CLI to the FeatBit
  experimentation web app over Server-Sent Events.

USAGE
  npx @featbit/experimentation-claude-code-connector [options]

OPTIONS
  --help, -h        Show this help

ENVIRONMENT
  PORT              Listen port           (default: 3100)
  HOST              Bind address          (default: 127.0.0.1, loopback only)
  CORS_ORIGINS      Comma-separated list  (default: https://app.featbit.ai,
                                                    https://featbit.ai,
                                                    http://localhost:3000)

REQUIREMENTS
  - Claude Code CLI installed and logged in (run \`claude\` once first)
  - Node.js >= 20

The connector listens on the loopback interface only, so the port is not
exposed to other devices on your network.
`);
  process.exit(0);
}

startServer({
  port: parsePort(process.env.PORT, DEFAULT_PORT),
  host: process.env.HOST ?? DEFAULT_HOST,
  corsOrigins: parseCors(process.env.CORS_ORIGINS),
});
