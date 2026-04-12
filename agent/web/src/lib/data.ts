import { prisma } from "@/lib/prisma";

export async function getExperiments() {
  return prisma.experiment.findMany({
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { experimentRuns: true } } },
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
}) {
  const experiment = await prisma.experiment.create({ data });
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return prisma.experimentRun.create({
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
    where: { status: { in: ["draft", "running", "collecting"] } },
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
