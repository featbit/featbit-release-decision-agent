#!/usr/bin/env npx tsx
/**
 * collect-input.ts — Query data source and write inputData to DB.
 *
 * Reads experiment definition from the DB via HTTP API,
 * calls fetchMetricSummary() for each variant × metric,
 * writes the collected inputData JSON back to the DB.
 *
 * Usage:
 *   npx tsx collect-input.ts <project-id> <experiment-slug>
 *
 * CUSTOMIZATION:
 *   Implement fetchMetricSummary() below for your data source.
 *   See references/data-source-guide.md for copy-paste patterns:
 *     §FeatBit  — call the experiment results API
 *     §Database — run a SQL aggregation query
 *     §Custom   — call your own metrics service
 *
 * Environment:
 *   SYNC_API_URL — base URL of the web app (default: http://localhost:3000)
 */

import { getExperiment, upsertExperiment, type Experiment } from "./db-client.js";

// ══════════════════════════════════════════════════════════════════════════════
// THE ONE FUNCTION YOU IMPLEMENT
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Return (n_exposed, n_converted) for one variant × metric combination.
 *
 * @param flagKey   — the FeatBit feature flag key
 * @param variant   — variant value, e.g. "false" / "true" / "control" / "v2"
 * @param metric    — event name, e.g. "click_start_chat"
 * @param start     — observation window start, ISO 8601 date string
 * @param end       — observation window end, ISO 8601 date string (or "open")
 *
 * @returns { n, k } where n = users exposed, k = users who converted
 *
 * See references/data-source-guide.md for ready-to-use implementations.
 */
async function fetchMetricSummary(
  _flagKey: string,
  _variant: string,
  _metric: string,
  _start: string,
  _end: string
): Promise<{ n: number; k: number }> {
  throw new Error(
    "Implement fetchMetricSummary() for your data source.\n" +
      "See references/data-source-guide.md:\n" +
      "  §FeatBit  — FeatBit experiment results API\n" +
      "  §Database — SQL aggregation query\n" +
      "  §Custom   — your own metrics service\n"
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════════════

function parseVariants(exp: Experiment): {
  control: string;
  treatments: string[];
} {
  const control = exp.controlVariant ?? "control";
  const treatment = exp.treatmentVariant ?? "treatment";
  const treatments = treatment.includes(",")
    ? treatment.split(",").map((s) => s.trim())
    : [treatment];
  return { control, treatments };
}

function parseGuardrails(exp: Experiment): string[] {
  if (!exp.guardrailEvents) return [];
  try {
    return JSON.parse(exp.guardrailEvents);
  } catch {
    return [];
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════════════════════

async function main(projectId: string, slug: string): Promise<void> {
  // 1. Read experiment from DB
  const exp = await getExperiment(projectId, slug);

  const { control, treatments } = parseVariants(exp);
  const guardrailEvents = parseGuardrails(exp);
  const primaryEvent = exp.primaryMetricEvent ?? "";
  const allMetrics = [primaryEvent, ...guardrailEvents].filter(Boolean);
  const allVariants = [control, ...treatments];

  // Use project-level flagKey if available (read from project via experiment)
  const flagKey = slug; // Default to slug; override in fetchMetricSummary if needed

  const start = exp.observationStart
    ? new Date(exp.observationStart).toISOString().split("T")[0]
    : "";
  const end = exp.observationEnd
    ? new Date(exp.observationEnd).toISOString().split("T")[0]
    : "open";

  if (!allMetrics.length) {
    console.error("ERROR: no metrics found in experiment definition");
    process.exit(1);
  }

  console.log(`Collecting input for: ${slug}`);
  console.log(`  control:   ${control}   treatment: ${treatments.join(", ")}`);
  console.log(`  window:    ${start} → ${end}`);
  console.log(`  metrics:   ${allMetrics.join(", ")}`);
  console.log();

  // 2. Collect data
  const result: Record<string, Record<string, { n: number; k: number }>> = {};
  for (const metric of allMetrics) {
    result[metric] = {};
    for (const variant of allVariants) {
      process.stdout.write(`  fetching ${metric} / ${variant} ... `);
      const { n, k } = await fetchMetricSummary(
        flagKey, variant, metric, start, end
      );
      result[metric][variant] = { n, k };
      console.log(`n=${n}  k=${k}`);
    }
  }

  // 3. Write inputData to DB
  const inputData = JSON.stringify({ metrics: result });
  await upsertExperiment(projectId, slug, { inputData });

  console.log(`\nInput data written to DB for ${projectId}/${slug}`);
  console.log(
    `Run analysis:\n  npx tsx analyze-bayesian.ts ${projectId} ${slug}`
  );
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const [projectId, slug] = process.argv.slice(2);
if (!projectId || !slug) {
  console.error(
    "Usage: npx tsx collect-input.ts <project-id> <experiment-slug>"
  );
  process.exit(1);
}
main(projectId, slug);
