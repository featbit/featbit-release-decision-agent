/**
 * scripts/sandbox0/update-env.ts
 *
 * Updates the cloud environment's `packages` config so VMs have the listed
 * tools pre-installed on every session create (no cold-download cost).
 *
 * Usage:
 *   npx tsx scripts/sandbox0/update-env.ts                # prints current config
 *   npx tsx scripts/sandbox0/update-env.ts --apply        # applies DEFAULT_PACKAGES
 *   npx tsx scripts/sandbox0/update-env.ts --apply --env env_xxx
 */

import "dotenv/config";
import { prisma } from "../../src/lib/prisma";

const BASE_URL = process.env.SANDBOX0_BASE_URL ?? "https://agents.sandbox0.ai";
const API_KEY = process.env.SANDBOX0_API_KEY ?? "";

const HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  "x-api-key": API_KEY,
  "anthropic-version": "2023-06-01",
  "anthropic-beta": "managed-agents-2026-04-01",
};

const DEFAULT_PACKAGES = {
  type: "packages" as const,
  apt: [] as string[],
  cargo: [] as string[],
  gem: [] as string[],
  go: [] as string[],
  npm: ["tsx"],
  pip: [] as string[],
};

async function getDefaultEnvId(): Promise<string> {
  const row = await prisma.managedAgent.findFirst({ where: { isDefault: true } });
  if (!row) throw new Error("No default managed agent registered. Run sandbox0:setup-agent first.");
  return row.environmentId;
}

async function fetchEnv(envId: string) {
  const r = await fetch(`${BASE_URL}/v1/environments/${envId}`, { headers: HEADERS });
  if (!r.ok) throw new Error(`GET /v1/environments/${envId} → ${r.status}: ${await r.text()}`);
  return r.json();
}

async function updateEnv(envId: string, packages: typeof DEFAULT_PACKAGES) {
  const r = await fetch(`${BASE_URL}/v1/environments/${envId}`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({
      config: {
        type: "cloud",
        networking: { type: "unrestricted" },
        packages,
      },
    }),
  });
  if (!r.ok) throw new Error(`POST /v1/environments/${envId} → ${r.status}: ${await r.text()}`);
  return r.json();
}

async function main() {
  if (!API_KEY) {
    console.error("SANDBOX0_API_KEY is not set");
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const envIdx = args.indexOf("--env");
  const envId = envIdx !== -1 ? args[envIdx + 1] : await getDefaultEnvId();

  console.log(`Environment: ${envId}`);
  const before = await fetchEnv(envId);
  console.log("Current packages:", JSON.stringify(before.config?.packages, null, 2));

  if (!apply) {
    console.log("\nDry run. Re-run with --apply to push:");
    console.log(JSON.stringify(DEFAULT_PACKAGES, null, 2));
    process.exit(0);
  }

  const updated = await updateEnv(envId, DEFAULT_PACKAGES);
  console.log("\nUpdated packages:", JSON.stringify(updated.config?.packages, null, 2));
  console.log("\n✓ Next new session will use the updated packages. Existing sessions are unaffected.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
