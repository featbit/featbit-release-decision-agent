/**
 * scripts/sandbox0/setup-vaults.ts
 *
 * One-time setup. Creates the LLM vault on sandbox0 (if it does not already
 * exist by name) and persists its vault_id into the `vault` table so that
 * session.ts and the setup-agent script can reference it.
 *
 * Usage:
 *   npx tsx scripts/sandbox0/setup-vaults.ts
 *
 * Required env: SANDBOX0_API_KEY, LLM_API_KEY, LLM_BASE_URL, DATABASE_URL
 */

import "dotenv/config";
import { getVault, upsertVault } from "../../src/lib/sandbox0/db";

const BASE_URL = process.env.SANDBOX0_BASE_URL ?? "https://agents.sandbox0.ai";
const API_KEY = process.env.SANDBOX0_API_KEY ?? "";

const HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  "x-api-key": API_KEY,
  "anthropic-version": "2023-06-01",
  "anthropic-beta": "managed-agents-2026-04-01",
};

async function createLlmVault(): Promise<string> {
  const llmApiKey = process.env.LLM_API_KEY;
  const llmBaseUrl = process.env.LLM_BASE_URL;
  if (!llmApiKey) throw new Error("LLM_API_KEY is not set");
  if (!llmBaseUrl) throw new Error("LLM_BASE_URL is not set");

  const res = await fetch(`${BASE_URL}/v1/vaults`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({
      display_name: "featbit-llm",
      description: "LLM inference credential for the release-decision agent",
    }),
  });
  if (!res.ok) throw new Error(`create vault: ${res.status} ${await res.text()}`);
  const vault = (await res.json()) as { id: string };

  const credRes = await fetch(`${BASE_URL}/v1/vaults/${vault.id}/credentials`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({
      display_name: "llm",
      engine: "claude",
      base_url: llmBaseUrl,
      auth: { type: "static_bearer", token: llmApiKey },
    }),
  });
  if (!credRes.ok) {
    throw new Error(`attach credential: ${credRes.status} ${await credRes.text()}`);
  }
  return vault.id;
}

async function main() {
  const existing = await getVault("llm");
  if (existing) {
    console.log(`Vault "llm" already persisted: ${existing.vaultId}`);
    console.log(`If you want to rotate the LLM token on this vault, use:`);
    console.log(`  NEW_LLM_API_KEY=<key> npm run sandbox0:rotate-llm-key`);
    process.exit(0);
  }

  console.log("Creating LLM vault on sandbox0...");
  const vaultId = await createLlmVault();
  console.log(`  created: ${vaultId}`);

  await upsertVault("llm", vaultId, null);
  console.log(`  persisted to DB as name="llm"`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
