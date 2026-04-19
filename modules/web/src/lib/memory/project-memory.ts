import { prisma } from "@/lib/prisma";
import type { ProjectMemoryType, ProjectMemoryUpsertInput } from "./types";

export async function getProjectMemory(
  projectKey: string,
  options: { type?: ProjectMemoryType } = {}
) {
  return prisma.projectMemory.findMany({
    where: {
      featbitProjectKey: projectKey,
      ...(options.type ? { type: options.type } : {}),
    },
    orderBy: [{ type: "asc" }, { key: "asc" }],
  });
}

export async function getProjectMemoryEntry(projectKey: string, key: string) {
  return prisma.projectMemory.findUnique({
    where: {
      featbitProjectKey_key: { featbitProjectKey: projectKey, key },
    },
  });
}

export async function upsertProjectMemory(
  projectKey: string,
  input: ProjectMemoryUpsertInput
) {
  const { key, type, content, sourceAgent, createdByUserId, editable } = input;
  return prisma.projectMemory.upsert({
    where: {
      featbitProjectKey_key: { featbitProjectKey: projectKey, key },
    },
    create: {
      featbitProjectKey: projectKey,
      key,
      type,
      content,
      sourceAgent: sourceAgent ?? null,
      createdByUserId: createdByUserId ?? null,
      editable: editable ?? true,
    },
    update: {
      type,
      content,
      sourceAgent: sourceAgent ?? null,
      ...(editable !== undefined ? { editable } : {}),
    },
  });
}

export async function deleteProjectMemory(projectKey: string, key: string) {
  return prisma.projectMemory.delete({
    where: {
      featbitProjectKey_key: { featbitProjectKey: projectKey, key },
    },
  });
}
