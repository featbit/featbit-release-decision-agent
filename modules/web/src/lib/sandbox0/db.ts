/**
 * Prisma-based data access for the sandbox0 managed-agents integration.
 *
 * Replaces modules/sandbox0-streaming/src/db.ts (which spoke raw pg). The
 * tables (experiment.sandbox_id, managed_agent, vault) already exist in the
 * Azure Postgres; this module exposes typed helpers over Prisma so both the
 * runtime route handlers and the setup scripts can share the same shape.
 */

import { prisma } from "@/lib/prisma";

export interface ExperimentRow {
  id: string;
  sandboxId: string | null;
  sandboxStatus: string | null;
  accessToken: string | null;
}

export interface ExperimentListItem {
  id: string;
  name?: string;
}

export async function listExperiments(): Promise<ExperimentListItem[]> {
  const rows = await prisma.experiment.findMany({
    select: { id: true, name: true, updatedAt: true, createdAt: true },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }, { id: "asc" }],
  });
  return rows.map((r) => ({ id: r.id, name: r.name ?? undefined }));
}

export async function getExperiment(experimentId: string): Promise<ExperimentRow | null> {
  const row = await prisma.experiment.findUnique({
    where: { id: experimentId },
    select: { id: true, sandboxId: true, sandboxStatus: true, accessToken: true },
  });
  return row;
}

export async function saveSandboxSession(
  experimentId: string,
  sessionId: string,
  status: string,
): Promise<void> {
  await prisma.experiment.update({
    where: { id: experimentId },
    data: { sandboxId: sessionId, sandboxStatus: status },
  });
}

export async function clearSandboxSession(experimentId: string): Promise<void> {
  await prisma.experiment.update({
    where: { id: experimentId },
    data: { sandboxId: null, sandboxStatus: "idle" },
  });
}

// ── Vault ────────────────────────────────────────────────────────────────────

export interface VaultRow {
  name: string;
  vaultId: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export async function getVault(name: string): Promise<VaultRow | null> {
  const row = await prisma.vault.findUnique({ where: { name } });
  if (!row) return null;
  return {
    name: row.name,
    vaultId: row.vaultId,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function upsertVault(
  name: string,
  vaultId: string,
  metadata: Record<string, unknown> | null,
): Promise<void> {
  // Prisma Json fields: null → Prisma.JsonNull, object → cast to InputJsonValue
  const metadataValue =
    metadata === null
      ? undefined
      : (metadata as Parameters<typeof prisma.vault.upsert>[0]["create"]["metadata"]);
  await prisma.vault.upsert({
    where: { name },
    create: { name, vaultId, metadata: metadataValue },
    update: { vaultId, metadata: metadataValue },
  });
}

// ── Managed agent ────────────────────────────────────────────────────────────

export interface ManagedAgentRow {
  version: string;
  agentId: string;
  environmentId: string;
  isDefault: boolean;
  createdAt: Date;
}

/**
 * Fetch the managed agent config by version. Pass "default" (or omit) to
 * resolve the row marked `is_default = true`.
 */
export async function getManagedAgent(version?: string): Promise<ManagedAgentRow | null> {
  if (!version || version === "default") {
    return prisma.managedAgent.findFirst({ where: { isDefault: true } });
  }
  return prisma.managedAgent.findUnique({ where: { version } });
}

export async function upsertManagedAgent(
  version: string,
  agentId: string,
  environmentId: string,
  isDefault: boolean,
): Promise<void> {
  if (isDefault) {
    await prisma.managedAgent.updateMany({
      where: { isDefault: true },
      data: { isDefault: false },
    });
  }
  await prisma.managedAgent.upsert({
    where: { version },
    create: { version, agentId, environmentId, isDefault },
    update: { agentId, environmentId, isDefault },
  });
}
