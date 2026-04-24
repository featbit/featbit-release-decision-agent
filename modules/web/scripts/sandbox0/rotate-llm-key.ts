/**
 * scripts/sandbox0/rotate-llm-key.ts
 *
 * Rotate the bearer token on the existing "llm" vault credential without
 * changing the vault_id. Existing sessions / managed agents keep working —
 * they reference the vault by id, not by the token value.
 *
 * Usage:
 *   NEW_LLM_API_KEY=<key> npx tsx scripts/sandbox0/rotate-llm-key.ts
 */

import "dotenv/config";
import { getVault } from "../../src/lib/sandbox0/db";

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
    console.error('Vault "llm" not found in DB. Run sandbox0:setup-vaults first.');
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
  const listed = (await listRes.json()) as {
    data?: Array<{ id: string; display_name?: string }>;
    credentials?: Array<{ id: string; display_name?: string }>;
  };
  const credentials = listed.data ?? listed.credentials ?? [];
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
