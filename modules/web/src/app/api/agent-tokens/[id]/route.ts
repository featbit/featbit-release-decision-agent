import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/server-auth/guard";
import { bridgeFetch } from "@/lib/server-auth/featbit-bridge";

export const runtime = "nodejs";

interface ListedProject {
  key: string;
}

async function userCanAccessProject(
  token: string,
  organizationId: string | null,
  workspaceId: string | null,
  projectKey: string,
): Promise<boolean> {
  const res = await bridgeFetch("/projects", {
    method: "GET",
    token,
    organizationId,
    workspaceId,
  });
  if (!res.ok) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(res.bodyText);
  } catch {
    return false;
  }
  const data =
    parsed && typeof parsed === "object" && "data" in parsed
      ? (parsed as { data: unknown }).data
      : parsed;
  const projects = Array.isArray(data) ? (data as ListedProject[]) : [];
  return projects.some((p) => p?.key === projectKey);
}

// DELETE /api/agent-tokens/[id] — revoke (soft delete via revokedAt).
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const existing = await prisma.agentToken.findUnique({
    where: { id },
    select: { id: true, projectKey: true, revokedAt: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Same project-membership gate as issuance — without it any logged-in user
  // could revoke tokens belonging to projects they aren't a member of.
  const allowed = await userCanAccessProject(
    auth.token,
    auth.organizationId,
    auth.workspaceId,
    existing.projectKey,
  );
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (existing.revokedAt) {
    return NextResponse.json({ ok: true, alreadyRevoked: true });
  }
  await prisma.agentToken.update({
    where: { id },
    data: { revokedAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}
