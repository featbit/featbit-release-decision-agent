import { NextResponse } from "next/server";
import { getSession } from "@/lib/server-auth/require";

export const runtime = "nodejs";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ profile: null }, { status: 200 });
  }
  return NextResponse.json({
    profile: session.profile,
    organizationId: session.organizationId,
    workspaceId: session.workspaceId,
  });
}
