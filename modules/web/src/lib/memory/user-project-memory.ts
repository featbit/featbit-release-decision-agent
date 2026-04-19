import { prisma } from "@/lib/prisma";
import type {
  UserProjectMemoryType,
  UserProjectMemoryUpsertInput,
} from "./types";

export async function getUserProjectMemory(
  projectKey: string,
  userId: string,
  options: { type?: UserProjectMemoryType } = {}
) {
  return prisma.userProjectMemory.findMany({
    where: {
      featbitProjectKey: projectKey,
      featbitUserId: userId,
      ...(options.type ? { type: options.type } : {}),
    },
    orderBy: [{ type: "asc" }, { key: "asc" }],
  });
}

export async function getUserProjectMemoryEntry(
  projectKey: string,
  userId: string,
  key: string
) {
  return prisma.userProjectMemory.findUnique({
    where: {
      featbitProjectKey_featbitUserId_key: {
        featbitProjectKey: projectKey,
        featbitUserId: userId,
        key,
      },
    },
  });
}

export async function upsertUserProjectMemory(
  projectKey: string,
  userId: string,
  input: UserProjectMemoryUpsertInput
) {
  const { key, type, content, sourceAgent } = input;
  return prisma.userProjectMemory.upsert({
    where: {
      featbitProjectKey_featbitUserId_key: {
        featbitProjectKey: projectKey,
        featbitUserId: userId,
        key,
      },
    },
    create: {
      featbitProjectKey: projectKey,
      featbitUserId: userId,
      key,
      type,
      content,
      sourceAgent: sourceAgent ?? null,
    },
    update: {
      type,
      content,
      sourceAgent: sourceAgent ?? null,
    },
  });
}

export async function deleteUserProjectMemory(
  projectKey: string,
  userId: string,
  key: string
) {
  return prisma.userProjectMemory.delete({
    where: {
      featbitProjectKey_featbitUserId_key: {
        featbitProjectKey: projectKey,
        featbitUserId: userId,
        key,
      },
    },
  });
}
