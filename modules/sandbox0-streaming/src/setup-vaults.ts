/**
 * setup-vaults.ts
 *
 * One-shot script: creates vaults if they don't exist, prints their IDs.
 *
 * Usage:
 *   npx tsx src/setup-vaults.ts
 */

import "dotenv/config";
import { ensureVaults } from "./vault.js";

async function main() {
  console.log("Setting up vaults...\n");

  const results = await ensureVaults();

  for (const r of results) {
    const tag = r.created ? "CREATED" : "EXISTS ";
    console.log(`  [${tag}] ${r.name}  →  ${r.vaultId}`);
  }

  console.log("\nDone.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
