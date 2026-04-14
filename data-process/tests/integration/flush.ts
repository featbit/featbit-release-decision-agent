/**
 * flush.ts — force DO → R2 delta write, then run rollup-service --run-once
 */

import { spawnSync }     from "child_process";
import path              from "path";
import { fileURLToPath } from "url";
import { CFG }           from "./config.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Mirror of cf-worker's sanitize() — replaces non-word/non-hyphen chars with '_' */
function sanitize(s: string): string {
  return s.replace(/[^\w-]/g, "_");
}

/** Build the partition keys that the cf-worker created for today */
function getPartKeys(): string[] {
  const today = new Date().toISOString().slice(0, 10);   // YYYY-MM-DD
  return [
    `fe:${sanitize(CFG.envId)}:${sanitize(CFG.flagKey)}:${today}`,
    `me:${sanitize(CFG.envId)}:${sanitize(CFG.metricEvent)}:${today}`,
  ];
}

export async function flushAndRollup(): Promise<void> {
  const partKeys = getPartKeys();
  console.log(`  Flushing ${partKeys.length} partition(s) via /dev/flush...`);

  const res = await fetch(`${CFG.workerUrl}/dev/flush`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ partKeys }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`/dev/flush failed [${res.status}]: ${text}`);
  }

  const { flushed, failed } = await res.json() as { flushed: string[]; failed: string[] };
  console.log(`  Flushed: ${flushed.length}  Failed: ${failed.length}`);
  if (failed.length > 0) throw new Error(`Some partitions failed to flush: ${failed.join(", ")}`);

  // Run rollup-service --run-once
  console.log("  Running rollup-service --run-once...");
  const rollupDir = path.resolve(__dirname, CFG.rollupServiceDir);

  const result = spawnSync("dotnet", ["run", "--no-build", "--", "--run-once"], {
    cwd:    rollupDir,
    stdio:  "inherit",
    env:    {
      ...process.env,
      R2_ACCOUNT_ID:        CFG.r2.accountId,
      R2_ACCESS_KEY_ID:     CFG.r2.accessKeyId,
      R2_SECRET_ACCESS_KEY: CFG.r2.secretKey,
    },
    timeout: 60_000,
  });

  if (result.status !== 0) {
    throw new Error(`rollup-service exited with status ${result.status}`);
  }

  console.log("  Rollup complete.");
}
