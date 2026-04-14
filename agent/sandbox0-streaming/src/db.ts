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
