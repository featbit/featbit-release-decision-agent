/**
 * rotate-llm-key.ts
 *
 * Rotate the bearer token on the existing "llm" vault credential in sandbox0,
 * keeping the same vault_id (so managed agent / sessions keep working).
 *
 * Usage:
 *   NEW_LLM_API_KEY=<key> npx tsx src/rotate-llm-key.ts
 */

import "dotenv/config";
import { getVault } from "./db.js";

const BASE_URL = process.env.SANDBOX0_BASE_URL ?? "https://agents.sandbox0.ai";
const API_KEY = process.env.SANDBOX0_API_KEY ?? "";

const HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  "x-api-key": API_KEY,
  "anthropic-version": "2023-06-01",
  "anthropic-beta": "managed-agents-2026-04-01",
};

async function main() {
  const newToken = process.env.NEW_LLM_API_KEY;
  if (!newToken) {
    console.error("NEW_LLM_API_KEY env var is required");
    process.exit(1);
  }

  const vault = await getVault("llm");
  if (!vault) {
    console.error('Vault "llm" not found in DB. Run `npm run setup-vaults` first.');
    process.exit(1);
  }
  console.log(`Vault: ${vault.vaultId}`);

  const listRes = await fetch(`${BASE_URL}/v1/vaults/${vault.vaultId}/credentials`, {
    headers: HEADERS,
  });
  if (!listRes.ok) {
    console.error(`List failed: ${listRes.status} ${await listRes.text()}`);
    process.exit(1);
  }
  const listed: any = await listRes.json();
  const credentials: any[] = listed.data ?? listed.credentials ?? [];
  if (credentials.length === 0) {
    console.error("No credentials on vault.");
    process.exit(1);
  }
  const cred = credentials[0];
  console.log(`Credential to rotate: ${cred.id} (${cred.display_name ?? "no name"})`);

  const updateRes = await fetch(
    `${BASE_URL}/v1/vaults/${vault.vaultId}/credentials/${cred.id}`,
    {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({
        auth: { type: "static_bearer", token: newToken },
      }),
    },
  );
  if (!updateRes.ok) {
    console.error(`Update failed: ${updateRes.status} ${await updateRes.text()}`);
    process.exit(1);
  }
  console.log("✓ Credential rotated. New sessions will use the new token.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
