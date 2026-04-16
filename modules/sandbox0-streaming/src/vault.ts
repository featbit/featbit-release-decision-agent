/**
 * vault.ts
 *
 * Manages Vaults via the sandbox0 REST API.
 *
 * Two vaults are maintained:
 *   - "llm"     — LLM credentials the agent uses to call Claude / other models
 *   - "service" — API key for authenticating with the sandbox0 managed-agents service
 *
 * Vault IDs are persisted in the `vault` table so they are only created once.
 * Re-running setup will skip creation if the vault already exists in the DB.
 */

import { ensureVaultTable, getVault, upsertVault } from "./db.js";

// ── Sandbox0 REST helpers ────────────────────────────────────────────────────

const BASE_URL = process.env.SANDBOX0_BASE_URL ?? "https://agents.sandbox0.ai";
const API_KEY = process.env.SANDBOX0_API_KEY ?? "";

const COMMON_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  "x-api-key": API_KEY,
  "anthropic-version": "2023-06-01",
  "anthropic-beta": "managed-agents-2026-04-01",
};

async function s0Post(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: COMMON_HEADERS,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

// ── Vault definitions ────────────────────────────────────────────────────────

interface VaultDef {
  /** Logical name (DB primary key) */
  name: string;
  displayName: string;
  metadata: Record<string, string>;
  credential: {
    displayName: string;
    envVar: string; // env var that holds the token value
  };
}

const VAULT_DEFS: VaultDef[] = [
  {
    name: "llm",
    displayName: "Claude LLM",
    metadata: {
      "sandbox0.managed_agents.role": "llm",
      "sandbox0.managed_agents.engine": "claude",
      "sandbox0.managed_agents.llm_base_url":
        process.env.LLM_BASE_URL ?? "https://open.bigmodel.cn/api/anthropic",
    },
    credential: {
      displayName: "LLM API key",
      envVar: "LLM_API_KEY",
    },
  },
];

// ── Public API ───────────────────────────────────────────────────────────────

export interface VaultResult {
  name: string;
  vaultId: string;
  created: boolean; // true = just created, false = already existed
}

/**
 * Ensure all vaults exist. Returns their IDs.
 * Safe to call multiple times — only creates what's missing.
 */
export async function ensureVaults(): Promise<VaultResult[]> {
  await ensureVaultTable();
  const results: VaultResult[] = [];

  for (const def of VAULT_DEFS) {
    const existing = await getVault(def.name);
    if (existing) {
      results.push({ name: def.name, vaultId: existing.vaultId, created: false });
      continue;
    }

    const token = process.env[def.credential.envVar];
    if (!token) {
      throw new Error(
        `Cannot create vault "${def.name}": env var ${def.credential.envVar} is not set`,
      );
    }

    // Create vault
    const vault = await s0Post("/v1/vaults", {
      display_name: def.displayName,
      metadata: def.metadata,
    });
    const vaultId: string = vault.id;

    // Store credential
    await s0Post(`/v1/vaults/${vaultId}/credentials`, {
      display_name: def.credential.displayName,
      auth: { type: "static_bearer", token },
    });

    // Persist to DB
    await upsertVault(def.name, vaultId, def.metadata);

    results.push({ name: def.name, vaultId, created: true });
  }

  return results;
}

/**
 * Get a single vault ID by logical name. Returns null if not yet created.
 */
export async function getVaultId(name: string): Promise<string | null> {
  await ensureVaultTable();
  const row = await getVault(name);
  return row?.vaultId ?? null;
}
