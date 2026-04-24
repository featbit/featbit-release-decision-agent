/**
 * scripts/sandbox0/setup-agent.ts
 *
 * One-time setup. Registers the default (environment, agent) pair in the
 * managed_agent table. After this runs successfully the Next.js route
 * handlers under /api/sandbox0/chat/* can create sessions.
 *
 * Usage:
 *   npx tsx scripts/sandbox0/setup-agent.ts                          # interactive
 *   npx tsx scripts/sandbox0/setup-agent.ts <agent_id> <env_id>      # explicit
 *   npx tsx scripts/sandbox0/setup-agent.ts --version v2 <agent_id> <env_id>
 *   npx tsx scripts/sandbox0/setup-agent.ts --list
 */

import "dotenv/config";
import { prisma } from "../../src/lib/prisma";
import { getManagedAgent, upsertManagedAgent } from "../../src/lib/sandbox0/db";

async function listAll() {
  const rows = await prisma.managedAgent.findMany({ orderBy: { createdAt: "asc" } });
  if (rows.length === 0) {
    console.log("No managed agents registered yet.");
  } else {
    console.table(rows);
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--list")) {
    await listAll();
    process.exit(0);
  }

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

  const isDefault = !args.includes("--no-default");
  const ndIdx = args.indexOf("--no-default");
  if (ndIdx !== -1) args.splice(ndIdx, 1);

  const agentId = args[0] || process.env.MANAGED_AGENT_ID;
  const environmentId = args[1] || process.env.MANAGED_ENVIRONMENT_ID;

  if (!agentId || !environmentId) {
    console.error(
      "Usage: npx tsx scripts/sandbox0/setup-agent.ts [--version <v>] [--no-default] <agent_id> <environment_id>\n" +
        "  Or set MANAGED_AGENT_ID and MANAGED_ENVIRONMENT_ID in .env",
    );
    process.exit(1);
  }

  await upsertManagedAgent(version, agentId, environmentId, isDefault);

  console.log(`\nManaged agent registered:`);
  console.log(`  version:        ${version}`);
  console.log(`  agent_id:       ${agentId}`);
  console.log(`  environment_id: ${environmentId}`);
  console.log(`  is_default:     ${isDefault}`);

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
