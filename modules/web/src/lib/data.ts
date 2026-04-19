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

/**
 * Guardrail definition for a single metric.
 * Used by the data server to collect + analyze each guardrail.
 */
export interface GuardrailDef {
  event: string;
  metricType: string;    // "binary" | "continuous"
  metricAgg: string;     // "once" | "sum" | "mean" | "count" | "latest"
  inverse: boolean;
}

/**
 * Parse guardrailEvents JSON into structured guardrail definitions.
 * Supports both legacy formats:
 *   - string[]: ["page_bounce", "session_duration_p50"]  → defaults to binary/once/non-inverse
 *   - GuardrailDef[]:  [{ event, metricType, metricAgg, inverse }]
 */
export function parseGuardrailDefs(raw: string | null | undefined): GuardrailDef[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item: string | Partial<GuardrailDef>) => {
      if (typeof item === "string") {
        return { event: item, metricType: "binary", metricAgg: "once", inverse: false };
      }
      return {
        event: item.event ?? "",
        metricType: item.metricType ?? "binary",
        metricAgg: item.metricAgg ?? "once",
        inverse: item.inverse ?? false,
      };
    }).filter((g: GuardrailDef) => g.event);
  } catch {
    return [];
  }
}
