import { prisma } from "@/lib/prisma";

export async function getProjects() {
  return prisma.project.findMany({
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { experiments: true } } },
  });
}

export async function getProject(id: string) {
  return prisma.project.findUnique({
    where: { id },
    include: {
      experiments: { orderBy: { createdAt: "desc" } },
      activities: { orderBy: { createdAt: "desc" }, take: 20 },
      messages: { orderBy: { createdAt: "asc" } },
    },
  });
}

export async function createProject(data: {
  name: string;
  description?: string;
}) {
  const project = await prisma.project.create({ data });
  await prisma.activity.create({
    data: {
      projectId: project.id,
      type: "stage_change",
      title: "Project created",
      detail: `Release decision project "${project.name}" created. Stage: intent`,
    },
  });
  return project;
}

export async function updateProject(
  id: string,
  data: Record<string, unknown>
) {
  return prisma.project.update({ where: { id }, data });
}

export async function deleteProject(id: string) {
  return prisma.project.delete({ where: { id } });
}

export async function updateProjectStage(id: string, stage: string) {
  const project = await prisma.project.update({
    where: { id },
    data: { stage },
  });
  await prisma.activity.create({
    data: {
      projectId: id,
      type: "stage_change",
      title: `Stage changed to ${stage}`,
    },
  });
  return project;
}

export async function createExperiment(
  projectId: string,
  data: { slug: string; primaryMetricEvent?: string }
) {
  return prisma.experiment.create({
    data: { projectId, ...data },
  });
}

export async function addActivity(
  projectId: string,
  data: { type: string; title: string; detail?: string }
) {
  return prisma.activity.create({
    data: { projectId, ...data },
  });
}

export async function getMessages(projectId: string) {
  return prisma.message.findMany({
    where: { projectId },
    orderBy: { createdAt: "asc" },
  });
}

export async function addMessage(
  projectId: string,
  data: { role: string; content: string; metadata?: string }
) {
  return prisma.message.create({
    data: { projectId, ...data },
  });
}
