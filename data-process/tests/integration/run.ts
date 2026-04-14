/**
 * run.ts — integration test orchestrator
 *
 * Prerequisites:
 *   1. cf-worker running:     cd cf-worker && npx wrangler dev --remote
 *   2. rollup-service built:  cd rollup-service && dotnet build
 *
 * Run:
 *   cd data-process/tests/integration
 *   npm install
 *   WORKER_URL=http://localhost:8787 npx tsx run.ts
 */

import { generateSeedData } from "./seed.ts";
import { writeEvents }      from "./write.ts";
import { flushAndRollup }   from "./flush.ts";
import { verify }           from "./verify.ts";

async function main(): Promise<void> {
  console.log("=== FeatBit Integration Test ===\n");

  // 1. Generate seed data with known expected outcomes
  console.log("[1/4] Generating seed data...");
  const data = generateSeedData();
  console.log(`  Users:        ${data.payloads.length}`);
  console.log(`  Variant A:    ${data.expected.variantA.users} users, ${data.expected.variantA.conversions} conversions (${(data.expected.variantA.convRate * 100).toFixed(1)}%)`);
  console.log(`  Variant B:    ${data.expected.variantB.users} users, ${data.expected.variantB.conversions} conversions (${(data.expected.variantB.convRate * 100).toFixed(1)}%)`);
  console.log();

  // 2. Write events to cf-worker
  console.log("[2/4] Writing events to cf-worker...");
  await writeEvents(data);
  console.log();

  // 3. Flush DOs and run rollup
  console.log("[3/4] Flushing DOs and running rollup-service...");
  await flushAndRollup();
  console.log();

  // 4. Verify results
  console.log("[4/4] Verifying results...");
  await verify(data);
}

main().catch(err => {
  console.error("Integration test failed:", err);
  process.exit(1);
});
