import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/server-auth/guard";
import {
  hashAgentToken,
  tokenPrefix,
  TOKEN_PLAINTEXT_PREFIX,
} from "@/lib/server-auth/guard";
import { bridgeFetch } from "@/lib/server-auth/featbit-bridge";

export const runtime = "nodejs";

interface ListedProject {
  id: string;
  key: string;
  name?: string;
}

/**
 * Confirm the authenticated user actually has access to `projectKey` on the
 * FeatBit backend before letting them mint a token for it. Without this a
 * logged-in user could issue tokens scoped to projects they aren't a member
 * of, just by guessing/leaking the key.
 */
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

function mintPlaintext(): string {
  return TOKEN_PLAINTEXT_PREFIX + randomBytes(24).toString("base64url");
}

// POST /api/agent-tokens — issue a new token. Returns plaintext ONCE.
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  let body: { projectKey?: unknown; label?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const projectKey = typeof body.projectKey === "string" ? body.projectKey.trim() : "";
  const label = typeof body.label === "string" ? body.label.trim() : "";
  if (!projectKey) {
    return NextResponse.json({ error: "projectKey is required" }, { status: 400 });
  }
  if (!label || label.length > 64) {
    return NextResponse.json(
      { error: "label is required and must be 1–64 chars" },
      { status: 400 },
    );
  }

  const orgId = req.headers.get("organization") ?? auth.organizationId ?? null;
  const wsId = req.headers.get("workspace") ?? auth.workspaceId ?? null;
  const allowed = await userCanAccessProject(auth.token, orgId, wsId, projectKey);
  if (!allowed) {
    return NextResponse.json(
      { error: "You do not have access to this project" },
      { status: 403 },
    );
  }

  const plaintext = mintPlaintext();
  const row = await prisma.agentToken.create({
    data: {
      tokenHash: hashAgentToken(plaintext),
      projectKey,
      prefix: tokenPrefix(plaintext),
      label,
      createdByUserId: auth.profile.id,
    },
    select: {
      id: true,
      prefix: true,
      label: true,
      issuedAt: true,
    },
  });

  return NextResponse.json(
    {
      id: row.id,
      prefix: row.prefix,
      label: row.label,
      issuedAt: row.issuedAt,
      // Plaintext is returned EXACTLY ONCE — never persisted, never re-fetchable.
      token: plaintext,
    },
    { status: 201 },
  );
}

// GET /api/agent-tokens?projectKey=... — list tokens for the given project.
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const projectKey = req.nextUrl.searchParams.get("projectKey")?.trim() ?? "";
  if (!projectKey) {
    return NextResponse.json({ error: "projectKey is required" }, { status: 400 });
  }

  const orgId = req.headers.get("organization") ?? auth.organizationId ?? null;
  const wsId = req.headers.get("workspace") ?? auth.workspaceId ?? null;
  const allowed = await userCanAccessProject(auth.token, orgId, wsId, projectKey);
  if (!allowed) {
    return NextResponse.json(
      { error: "You do not have access to this project" },
      { status: 403 },
    );
  }

  const rows = await prisma.agentToken.findMany({
    where: { projectKey },
    orderBy: { issuedAt: "desc" },
    select: {
      id: true,
      prefix: true,
      label: true,
      issuedAt: true,
      lastUsedAt: true,
      revokedAt: true,
      createdByUserId: true,
    },
  });

  return NextResponse.json(rows);
}
