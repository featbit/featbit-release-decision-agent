/**
 * verify.ts — query the experiment result and assert against expected values
 */

import { CFG }         from "./config.ts";
import type { SeedData } from "./seed.ts";
import type { ExperimentQueryRequest, ExperimentQueryResponse, VariantStats } from "./types.ts";

export async function verify(data: SeedData): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);

  const body: ExperimentQueryRequest = {
    envId:       CFG.envId,
    flagKey:     CFG.flagKey,
    metricEvent: CFG.metricEvent,
    dates:       [today],
  };

  console.log("  Querying experiment results...");
  const res = await fetch(`${CFG.workerUrl}/api/query/experiment`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`/api/query/experiment failed [${res.status}]: ${text}`);
  }

  const result = await res.json() as ExperimentQueryResponse;
  const errors: string[] = [];

  function assertClose(label: string, actual: number, expected: number): void {
    const diff   = Math.abs(actual - expected);
    const status = diff <= CFG.tolerance ? "PASS" : "FAIL";
    console.log(`    [${status}] ${label}: actual=${actual.toFixed(4)} expected=${expected.toFixed(4)} diff=${diff.toFixed(4)}`);
    if (diff > CFG.tolerance) errors.push(`${label}: ${actual.toFixed(4)} vs ${expected.toFixed(4)} (diff ${diff.toFixed(4)} > tolerance ${CFG.tolerance})`);
  }

  function assertEq(label: string, actual: number, expected: number): void {
    const status = actual === expected ? "PASS" : "FAIL";
    console.log(`    [${status}] ${label}: actual=${actual} expected=${expected}`);
    if (actual !== expected) errors.push(`${label}: ${actual} !== ${expected}`);
  }

  console.log("\n  === Variant A (control) ===");
  const va: VariantStats | undefined = result[CFG.variantA];
  if (!va) {
    errors.push(`Variant "${CFG.variantA}" not found in response`);
  } else {
    assertEq   ("users",          va.users,          data.expected.variantA.users);
    assertEq   ("conversions",    va.conversions,    data.expected.variantA.conversions);
    assertClose("conversionRate", va.conversionRate, data.expected.variantA.convRate);
  }

  console.log("\n  === Variant B (treatment) ===");
  const vb: VariantStats | undefined = result[CFG.variantB];
  if (!vb) {
    errors.push(`Variant "${CFG.variantB}" not found in response`);
  } else {
    assertEq   ("users",          vb.users,          data.expected.variantB.users);
    assertEq   ("conversions",    vb.conversions,    data.expected.variantB.conversions);
    assertClose("conversionRate", vb.conversionRate, data.expected.variantB.convRate);
  }

  console.log();
  if (errors.length > 0) {
    console.error("ASSERTIONS FAILED:");
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  } else {
    console.log("All assertions passed.");
  }
}
