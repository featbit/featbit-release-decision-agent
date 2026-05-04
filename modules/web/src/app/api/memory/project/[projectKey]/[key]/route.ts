import { NextRequest, NextResponse } from "next/server";
import {
  deleteProjectMemory,
  getProjectMemoryEntry,
} from "@/lib/memory";
import { requireAuth } from "@/lib/server-auth/guard";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ projectKey: string; key: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { projectKey, key } = await params;
  const entry = await getProjectMemoryEntry(projectKey, key);
  if (!entry) {
    return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  }
  return NextResponse.json(entry);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ projectKey: string; key: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { projectKey, key } = await params;
  const existing = await getProjectMemoryEntry(projectKey, key);
  if (!existing) {
    return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  }
  await deleteProjectMemory(projectKey, key);
  return NextResponse.json({ ok: true });
}
