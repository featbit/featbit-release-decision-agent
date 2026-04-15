/**
 * run-active-test entry point.
 *
 *   1. Ensure the fixed experiment + experiment_run exist in PostgreSQL.
 *   2. Start the generator loop (every TICK_SECONDS send 0–N events).
 */

import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

import { runGeneratorLoop } from "./generator.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  // Run setup-db in-process by just importing it is tricky (it exits), so
  // spawn it synchronously — it's idempotent and fast.
  const setupPath = path.resolve(__dirname, "setup-db.ts");
  const result = spawnSync("npx", ["tsx", setupPath], {
    stdio: "inherit",
    env:   process.env,
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    console.error("[run-active-test] setup-db failed, aborting.");
    process.exit(result.status ?? 1);
  }

  await runGeneratorLoop();
}

main().catch((e) => {
  console.error("[run-active-test] fatal:", e);
  process.exit(1);
});
