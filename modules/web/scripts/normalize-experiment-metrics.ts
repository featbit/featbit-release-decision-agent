/**
 * Normalise an experiment's metric definitions to the canonical vocabulary.
 *
 * Migrates:
 *   - Experiment.primaryMetric JSON: metricType "numeric" → "continuous"
 *   - Experiment.guardrails JSON:    metricType "numeric" → "continuous";
 *                                    direction → derived inverse
 *   - ExperimentRun.primaryMetricType:  "numeric" → "continuous"
 *   - ExperimentRun.primaryMetricAgg:   "last" → "once" (legacy values)
 *   - ExperimentRun.guardrailEvents:    bare string[] → GuardrailDef[]
 *                                       (event + metricType + metricAgg + inverse)
 *
 * Only the LATEST run is touched (matches propagateMetricsToLatestRun).
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/normalize-experiment-metrics.ts <experiment-id>             # inspect (dry-run)
 *   DATABASE_URL=... npx tsx scripts/normalize-experiment-metrics.ts <experiment-id> --apply     # write changes
 */
import { PrismaClient } from "../src/generated/prisma";

type GuardrailIn = {
  event?: string;
  name?: string;
  metricType?: string;
  metricAgg?: string;
  direction?: string;
  inverse?: boolean;
  description?: string;
  dataSource?: string;
  dataSourceNote?: string;
};

type GuardrailDef = {
  event: string;
  metricType: "binary" | "continuous";
  metricAgg: "once" | "count" | "sum" | "average";
  inverse: boolean;
};

function normalizeMetricType(v: unknown): "binary" | "continuous" {
  return v === "continuous" || v === "numeric" ? "continuous" : "binary";
}

function normalizeMetricAgg(v: unknown, type: "binary" | "continuous"): "once" | "count" | "sum" | "average" {
  if (type === "binary") return "once";
  return v === "count" || v === "sum" || v === "average" ? v : "sum";
}

function normalizePrimaryMetric(raw: string | null): { json: string | null; changed: boolean } {
  if (!raw) return { json: null, changed: false };
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { json: raw, changed: false };
  }
  const metricType = normalizeMetricType(parsed.metricType);
  const metricAgg  = normalizeMetricAgg(parsed.metricAgg, metricType);
  const next = { ...parsed, metricType, metricAgg };
  const nextJson = JSON.stringify(next);
  return { json: nextJson, changed: nextJson !== raw };
}

function normalizeGuardrails(raw: string | null): { json: string | null; changed: boolean } {
  if (!raw) return { json: null, changed: false };
  let parsed: GuardrailIn[];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return { json: raw, changed: false };
    parsed = v as GuardrailIn[];
  } catch {
    return { json: raw, changed: false };
  }
  const next = parsed.map((g) => {
    const metricType = normalizeMetricType(g.metricType);
    const metricAgg  = normalizeMetricAgg(g.metricAgg, metricType);
    // direction=increase_bad ⇔ "lower is better" ⇔ inverse=true.
    // direction=decrease_bad ⇔ "higher is better" ⇔ inverse=false.
    const inverse = g.inverse ?? g.direction === "increase_bad";
    return {
      ...g,
      metricType,
      metricAgg,
      inverse,
    };
  });
  const nextJson = JSON.stringify(next);
  return { json: nextJson, changed: nextJson !== raw };
}

/** Run-side guardrail column: rich GuardrailDef[] only — no UI fields. */
function buildRunGuardrailEvents(experimentGuardrailsJson: string | null): string | null {
  if (!experimentGuardrailsJson) return null;
  let parsed: GuardrailIn[];
  try {
    const v = JSON.parse(experimentGuardrailsJson);
    if (!Array.isArray(v)) return null;
    parsed = v as GuardrailIn[];
  } catch {
    return null;
  }
  const defs: GuardrailDef[] = parsed
    .map((g) => {
      const metricType = normalizeMetricType(g.metricType);
      const metricAgg  = normalizeMetricAgg(g.metricAgg, metricType);
      const inverse    = g.inverse ?? g.direction === "increase_bad";
      const event      = (g.event ?? g.name ?? "").trim();
      return event ? { event, metricType, metricAgg, inverse } : null;
    })
    .filter((g): g is GuardrailDef => g !== null);
  return defs.length > 0 ? JSON.stringify(defs) : null;
}

async function main() {
  const experimentId = process.argv[2];
  const apply = process.argv.includes("--apply");
  if (!experimentId) {
    throw new Error(
      "Usage: npx tsx scripts/normalize-experiment-metrics.ts <experiment-id> [--apply]",
    );
  }

  const prisma = new PrismaClient();

  try {
    // ── Read current state ─────────────────────────────────────────────
    const exp = await prisma.experiment.findUnique({
      where: { id: experimentId },
      select: { id: true, primaryMetric: true, guardrails: true },
    });
    if (!exp) {
      throw new Error(`Experiment ${experimentId} not found`);
    }

    const run = await prisma.experimentRun.findFirst({
      where: { experimentId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        slug: true,
        primaryMetricEvent: true,
        primaryMetricType: true,
        primaryMetricAgg: true,
        guardrailEvents: true,
      },
    });

    console.log("─── BEFORE ─────────────────────────────────────────────");
    console.log("experiment.primaryMetric:", exp.primaryMetric);
    console.log("experiment.guardrails:   ", exp.guardrails);
    if (run) {
      console.log("run.slug:                ", run.slug);
      console.log("run.primaryMetricEvent:  ", run.primaryMetricEvent);
      console.log("run.primaryMetricType:   ", run.primaryMetricType);
      console.log("run.primaryMetricAgg:    ", run.primaryMetricAgg);
      console.log("run.guardrailEvents:     ", run.guardrailEvents);
    } else {
      console.log("(no experiment_run rows)");
    }

    // ── Compute canonical state ────────────────────────────────────────
    const newPrimary = normalizePrimaryMetric(exp.primaryMetric);
    const newGuardrails = normalizeGuardrails(exp.guardrails);

    // Run row's primaryMetricEvent / type / agg are derived from the
    // (now-canonical) Experiment.primaryMetric JSON.
    let runPrimaryEvent: string | null = null;
    let runPrimaryType: "binary" | "continuous" = "binary";
    let runPrimaryAgg: "once" | "count" | "sum" | "average" = "once";
    if (newPrimary.json) {
      try {
        const parsed = JSON.parse(newPrimary.json) as Record<string, unknown>;
        runPrimaryEvent = (parsed.event as string) ?? null;
        runPrimaryType  = normalizeMetricType(parsed.metricType);
        runPrimaryAgg   = normalizeMetricAgg(parsed.metricAgg, runPrimaryType);
      } catch { /* leave defaults */ }
    }

    // Run row's guardrailEvents stores GuardrailDef[] (rich).
    const runGuardrailEvents = buildRunGuardrailEvents(newGuardrails.json);

    console.log("\n─── AFTER (canonical) ─────────────────────────────────");
    console.log("experiment.primaryMetric:", newPrimary.json);
    console.log("experiment.guardrails:   ", newGuardrails.json);
    if (run) {
      console.log("run.primaryMetricEvent:  ", runPrimaryEvent);
      console.log("run.primaryMetricType:   ", runPrimaryType);
      console.log("run.primaryMetricAgg:    ", runPrimaryAgg);
      console.log("run.guardrailEvents:     ", runGuardrailEvents);
    }

    const changes: string[] = [];
    if (newPrimary.changed) changes.push("experiment.primaryMetric");
    if (newGuardrails.changed) changes.push("experiment.guardrails");
    if (run && run.primaryMetricEvent !== runPrimaryEvent) changes.push("run.primaryMetricEvent");
    if (run && run.primaryMetricType !== runPrimaryType) changes.push("run.primaryMetricType");
    if (run && run.primaryMetricAgg !== runPrimaryAgg) changes.push("run.primaryMetricAgg");
    if (run && run.guardrailEvents !== runGuardrailEvents) changes.push("run.guardrailEvents");

    if (changes.length === 0) {
      console.log("\n✓ No changes — already canonical.");
      return;
    }

    console.log(`\n${changes.length} field(s) will change:\n  - ${changes.join("\n  - ")}`);

    if (!apply) {
      console.log("\nDry run only. Re-run with --apply to write.");
      return;
    }

    // ── Apply ──────────────────────────────────────────────────────────
    await prisma.$transaction(async (tx) => {
      await tx.experiment.update({
        where: { id: experimentId },
        data: {
          primaryMetric: newPrimary.json,
          guardrails:    newGuardrails.json,
        },
      });
      if (run) {
        await tx.experimentRun.update({
          where: { id: run.id },
          data: {
            primaryMetricEvent: runPrimaryEvent,
            primaryMetricType:  runPrimaryType,
            primaryMetricAgg:   runPrimaryAgg,
            guardrailEvents:    runGuardrailEvents,
          },
        });
      }
    });
    console.log("\n✓ Applied.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
