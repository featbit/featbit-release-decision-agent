import { NextRequest, NextResponse } from "next/server";
import {
  deleteUserProjectMemory,
  getUserProjectMemoryEntry,
} from "@/lib/memory";
import { requireAuth } from "@/lib/server-auth/guard";

export async function GET(
  _req: NextRequest,
  {
    params,
  }: {
    params: Promise<{ projectKey: string; userId: string; key: string }>;
  }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { projectKey, userId, key } = await params;
  const entry = await getUserProjectMemoryEntry(projectKey, userId, key);
  if (!entry) {
    return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  }
  return NextResponse.json(entry);
}

export async function DELETE(
  _req: NextRequest,
  {
    params,
  }: {
    params: Promise<{ projectKey: string; userId: string; key: string }>;
  }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { projectKey, userId, key } = await params;
  const existing = await getUserProjectMemoryEntry(projectKey, userId, key);
  if (!existing) {
    return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  }
  await deleteUserProjectMemory(projectKey, userId, key);
  return NextResponse.json({ ok: true });
}
