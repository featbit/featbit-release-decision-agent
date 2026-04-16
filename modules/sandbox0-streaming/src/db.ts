/**
 * db.ts
 *
 * Minimal pg client — only the two queries sandbox0-streaming needs:
 *   1. Look up experiment by ID to get sandboxId + secrets
 *   2. Write back the sandboxId after creating a new CMA session
 */

import pg from "pg";

const { Pool } = pg;

let _pool: pg.Pool | null = null;

function getPool(): pg.Pool {
  if (!_pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    _pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
  }
  return _pool;
}

export interface ExperimentRow {
  id: string;
  sandboxId: string | null;
  sandboxStatus: string | null;
  accessToken: string | null;
}

export async function getExperiment(experimentId: string): Promise<ExperimentRow | null> {
  const result = await getPool().query<{
    id: string;
    sandbox_id: string | null;
    sandbox_status: string | null;
    access_token: string | null;
  }>(
    `SELECT id, sandbox_id, sandbox_status, access_token
       FROM experiment WHERE id = $1`,
    [experimentId],
  );
  if (result.rows.length === 0) return null;
  const r = result.rows[0];
  return {
    id: r.id,
    sandboxId: r.sandbox_id,
    sandboxStatus: r.sandbox_status,
    accessToken: r.access_token,
  };
}

export async function saveSandboxSession(
  experimentId: string,
  sessionId: string,
  status: string,
): Promise<void> {
  await getPool().query(
    `UPDATE experiment SET sandbox_id = $1, sandbox_status = $2 WHERE id = $3`,
    [sessionId, status, experimentId],
  );
}

export async function clearSandboxSession(experimentId: string): Promise<void> {
  await getPool().query(
    `UPDATE experiment SET sandbox_id = NULL, sandbox_status = 'idle' WHERE id = $1`,
    [experimentId],
  );
}

// ── Vault table ──────────────────────────────────────────────────────────────

export async function ensureVaultTable(): Promise<void> {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS vault (
      name        TEXT PRIMARY KEY,
      vault_id    TEXT NOT NULL,
      metadata    JSONB,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

export interface VaultRow {
  name: string;
  vaultId: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export async function getVault(name: string): Promise<VaultRow | null> {
  const result = await getPool().query<{
    name: string;
    vault_id: string;
    metadata: Record<string, unknown> | null;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT name, vault_id, metadata, created_at, updated_at FROM vault WHERE name = $1`,
    [name],
  );
  if (result.rows.length === 0) return null;
  const r = result.rows[0];
  return {
    name: r.name,
    vaultId: r.vault_id,
    metadata: r.metadata,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function upsertVault(
  name: string,
  vaultId: string,
  metadata: Record<string, unknown> | null,
): Promise<void> {
  await getPool().query(
    `INSERT INTO vault (name, vault_id, metadata)
     VALUES ($1, $2, $3)
     ON CONFLICT (name) DO UPDATE
       SET vault_id = EXCLUDED.vault_id,
           metadata = EXCLUDED.metadata,
           updated_at = now()`,
    [name, vaultId, metadata ? JSON.stringify(metadata) : null],
  );
}

// ── Managed Agent table ──────────────────────────────────────────────────────

export async function ensureManagedAgentTable(): Promise<void> {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS managed_agent (
      version        TEXT PRIMARY KEY,
      agent_id       TEXT NOT NULL,
      environment_id TEXT NOT NULL,
      is_default     BOOLEAN NOT NULL DEFAULT false,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

export interface ManagedAgentRow {
  version: string;
  agentId: string;
  environmentId: string;
  isDefault: boolean;
  createdAt: Date;
}

/**
 * Get managed agent config by version.
 * Pass "default" (or omit) to fetch the row marked is_default = true.
 */
export async function getManagedAgent(version?: string): Promise<ManagedAgentRow | null> {
  const isDefault = !version || version === "default";
  const result = await getPool().query<{
    version: string;
    agent_id: string;
    environment_id: string;
    is_default: boolean;
    created_at: Date;
  }>(
    isDefault
      ? `SELECT version, agent_id, environment_id, is_default, created_at
           FROM managed_agent WHERE is_default = true LIMIT 1`
      : `SELECT version, agent_id, environment_id, is_default, created_at
           FROM managed_agent WHERE version = $1`,
    isDefault ? [] : [version],
  );
  if (result.rows.length === 0) return null;
  const r = result.rows[0];
  return {
    version: r.version,
    agentId: r.agent_id,
    environmentId: r.environment_id,
    isDefault: r.is_default,
    createdAt: r.created_at,
  };
}

/**
 * Upsert a managed agent version. If is_default is true, clears default on all other rows first.
 */
export async function upsertManagedAgent(
  version: string,
  agentId: string,
  environmentId: string,
  isDefault: boolean,
): Promise<void> {
  const pool = getPool();
  if (isDefault) {
    await pool.query(`UPDATE managed_agent SET is_default = false WHERE is_default = true`);
  }
  await pool.query(
    `INSERT INTO managed_agent (version, agent_id, environment_id, is_default)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (version) DO UPDATE
       SET agent_id = EXCLUDED.agent_id,
           environment_id = EXCLUDED.environment_id,
           is_default = EXCLUDED.is_default`,
    [version, agentId, environmentId, isDefault],
  );
}
