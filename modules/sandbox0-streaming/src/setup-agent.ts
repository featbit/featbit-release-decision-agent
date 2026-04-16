/**
 * setup-agent.ts
 *
 * Register a managed agent + environment pair in the database.
 *
 * Usage:
 *   npx tsx src/setup-agent.ts                          # interactive: reads MANAGED_AGENT_ID & MANAGED_ENVIRONMENT_ID from .env
 *   npx tsx src/setup-agent.ts <agent_id> <env_id>      # explicit IDs
 *   npx tsx src/setup-agent.ts --version v2 <agent_id> <env_id>
 *   npx tsx src/setup-agent.ts --list                   # list all registered versions
 */

import "dotenv/config";
import {
  ensureManagedAgentTable,
  upsertManagedAgent,
  getManagedAgent,
} from "./db.js";
import pg from "pg";

const { Pool } = pg;

async function listAll() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await ensureManagedAgentTable();
  const result = await pool.query(
    `SELECT version, agent_id, environment_id, is_default, created_at
       FROM managed_agent ORDER BY created_at`,
  );
  if (result.rows.length === 0) {
    console.log("No managed agents registered yet.");
  } else {
    console.table(result.rows);
  }
  await pool.end();
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--list")) {
    await listAll();
    return;
  }

  // Parse --version flag
  let version = "default";
  const vIdx = args.indexOf("--version");
  if (vIdx !== -1) {
    version = args[vIdx + 1];
    if (!version) {
      console.error("--version requires a value");
      process.exit(1);
    }
    args.splice(vIdx, 2);
  }

  // Parse --no-default flag
  const isDefault = !args.includes("--no-default");
  const ndIdx = args.indexOf("--no-default");
  if (ndIdx !== -1) args.splice(ndIdx, 1);

  // Remaining positional args: [agent_id] [environment_id]
  const agentId = args[0] || process.env.MANAGED_AGENT_ID;
  const environmentId = args[1] || process.env.MANAGED_ENVIRONMENT_ID;

  if (!agentId || !environmentId) {
    console.error(
      "Usage: npx tsx src/setup-agent.ts [--version <v>] [--no-default] <agent_id> <environment_id>\n" +
        "  Or set MANAGED_AGENT_ID and MANAGED_ENVIRONMENT_ID in .env",
    );
    process.exit(1);
  }

  await ensureManagedAgentTable();
  await upsertManagedAgent(version, agentId, environmentId, isDefault);

  console.log(`\nManaged agent registered:`);
  console.log(`  version:        ${version}`);
  console.log(`  agent_id:       ${agentId}`);
  console.log(`  environment_id: ${environmentId}`);
  console.log(`  is_default:     ${isDefault}`);

  // Verify
  const row = await getManagedAgent(version);
  if (row) {
    console.log(`\n  ✓ Verified in DB (created_at: ${row.createdAt.toISOString()})`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
