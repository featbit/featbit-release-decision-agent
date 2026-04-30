import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";

const ENV_COOKIE_NAME = "fb_env_id";

export async function getCurrentEnvId(): Promise<string | null> {
  try {
    const store = await cookies();
    return store.get(ENV_COOKIE_NAME)?.value || null;
  } catch {
    return null;
  }
}

export async function getExperiments() {
  const envId = await getCurrentEnvId();
  return prisma.experiment.findMany({
    where: envId ? { featbitEnvId: envId } : { featbitEnvId: { not: null } },
    orderBy: { updatedAt: "desc" },
  });
}

export async function getExperiment(id: string) {
  return prisma.experiment.findUnique({
    where: { id },
    include: {
      experimentRuns: { orderBy: { createdAt: "desc" } },
      activities: { orderBy: { createdAt: "desc" }, take: 20 },
      messages: { orderBy: { createdAt: "asc" } },
    },
  });
}

export async function createExperiment(data: {
  name: string;
  description?: string;
  featbitProjectKey?: string | null;
}) {
  const envId = await getCurrentEnvId();
  const experiment = await prisma.experiment.create({
    data: {
      ...data,
      featbitEnvId: envId ?? undefined,
      featbitProjectKey: data.featbitProjectKey ?? undefined,
    },
  });
  await prisma.activity.create({
    data: {
      experimentId: experiment.id,
      type: "stage_change",
      title: "Experiment created",
      detail: `Release decision experiment "${experiment.name}" created. Stage: intent`,
    },
  });
  return experiment;
}

export async function updateExperiment(
  id: string,
  data: Record<string, unknown>
) {
  return prisma.experiment.update({ where: { id }, data });
}

export async function deleteExperiment(id: string) {
  return prisma.experiment.delete({ where: { id } });
}

export async function updateExperimentStage(id: string, stage: string) {
  const experiment = await prisma.experiment.update({
    where: { id },
    data: { stage },
  });
  await prisma.activity.create({
    data: {
      experimentId: id,
      type: "stage_change",
      title: `Stage changed to ${stage}`,
    },
  });
  return experiment;
}

export async function createExperimentRun(
  experimentId: string,
  data: { slug: string; [key: string]: unknown }
) {
  return prisma.experimentRun.create({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: { experimentId, ...data } as any,
  });
}

export async function updateExperimentRun(
  id: string,
  data: Record<string, unknown>
) {
  return prisma.experimentRun.update({ where: { id }, data });
}

export async function deleteExperimentRun(id: string) {
  return prisma.experimentRun.delete({ where: { id } });
}

export async function addActivity(
  experimentId: string,
  data: { type: string; title: string; detail?: string }
) {
  return prisma.activity.create({
    data: { experimentId, ...data },
  });
}

export async function getMessages(experimentId: string) {
  return prisma.message.findMany({
    where: { experimentId },
    orderBy: { createdAt: "asc" },
  });
}

export async function addMessage(
  experimentId: string,
  data: { role: string; content: string; metadata?: string }
) {
  return prisma.message.create({
    data: { experimentId, ...data },
  });
}

export async function getRunningExperimentRuns() {
  return prisma.experimentRun.findMany({
    where: { status: { in: ["draft", "collecting", "analyzing"] } },
    include: {
      experiment: {
        select: {
          id: true,
          flagKey: true,
          envSecret: true,
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });
}

// ─── Metric vocabulary normalisation ────────────────────────────────────────
// Single canonical vocabulary shared with sync.ts and the run validator.
// "numeric" was a UI-only legacy spelling; treat it as "continuous" on read.
function normalizeMetricType(value: unknown): "binary" | "continuous" {
  return value === "continuous" || value === "numeric" ? "continuous" : "binary";
}

function normalizeMetricAgg(value: unknown): "once" | "count" | "sum" | "average" {
  return value === "count" || value === "sum" || value === "average" ? value : "once";
}

/**
 * Push primary-metric / guardrail definitions from the Experiment row to the
 * latest ExperimentRun row. The analysis API (`/api/experiments/[id]/analyze`)
 * reads from the run row, NOT the experiment row, so any setup-side write
 * (Edit Metrics dialog, /state PUT, etc.) MUST call this to keep the two
 * in sync. Without it the run keeps stale or empty type/agg fields and the
 * analysis silently uses defaults.
 *
 * Returns the run that was updated, or null if the experiment has no run yet.
 */
export async function propagateMetricsToLatestRun(
  experimentId: string,
  fields: { primaryMetric?: string | null; guardrails?: string | null },
) {
  const run = await prisma.experimentRun.findFirst({
    where: { experimentId },
    orderBy: { createdAt: "desc" },
  });
  if (!run) return null;

  const update: Record<string, unknown> = {};

  if (fields.primaryMetric !== undefined) {
    try {
      const parsed = fields.primaryMetric ? JSON.parse(fields.primaryMetric) : null;
      if (parsed && typeof parsed === "object" && parsed.event) {
        update.primaryMetricEvent = parsed.event;
        update.primaryMetricType = normalizeMetricType(parsed.metricType);
        update.primaryMetricAgg  = normalizeMetricAgg(parsed.metricAgg);
        if (parsed.description) update.metricDescription = parsed.description;
      }
    } catch { /* ignore — leave run unchanged */ }
  }

  if (fields.guardrails !== undefined) {
    try {
      const defs = parseGuardrailDefs(fields.guardrails);
      // Store as the rich GuardrailDef[] shape so analyze.ts can read
      // metricType/metricAgg/inverse without re-parsing the experiment row.
      update.guardrailEvents = defs.length > 0 ? JSON.stringify(defs) : null;
    } catch { /* ignore */ }
  }

  if (Object.keys(update).length === 0) return run;

  return prisma.experimentRun.update({ where: { id: run.id }, data: update });
}

/**
 * Guardrail definition for a single metric.
 * Used by the data server to collect + analyze each guardrail.
 */
export interface GuardrailDef {
  event: string;
  metricType: string;    // canonical: "binary" | "continuous" (legacy "numeric" tolerated on read)
  metricAgg: string;     // canonical: "once" | "count" | "sum" | "average"
  inverse: boolean;
}

/**
 * Parse guardrailEvents JSON into structured guardrail definitions.
 * Supports both legacy formats:
 *   - string[]: ["page_bounce", "session_duration_p50"]  → defaults to binary/once/non-inverse
 *   - GuardrailDef[]:  [{ event, metricType, metricAgg, inverse, direction? }]
 *
 * Legacy "numeric" metricType is normalised to canonical "continuous". `direction`
 * (from older entries) is collapsed into `inverse` (decrease_bad → inverse=true).
 */
export function parseGuardrailDefs(raw: string | null | undefined): GuardrailDef[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item: string | (Partial<GuardrailDef> & { direction?: string })) => {
      if (typeof item === "string") {
        return { event: item, metricType: "binary", metricAgg: "once", inverse: false };
      }
      const metricType = item.metricType === "numeric" ? "continuous" : (item.metricType ?? "binary");
      const inverse = item.inverse ?? item.direction === "decrease_bad";
      return {
        event: item.event ?? "",
        metricType,
        metricAgg: item.metricAgg ?? "once",
        inverse,
      };
    }).filter((g: GuardrailDef) => g.event);
  } catch {
    return [];
  }
}
