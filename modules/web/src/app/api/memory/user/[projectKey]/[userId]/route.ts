import { NextRequest, NextResponse } from "next/server";
import {
  getUserProjectMemory,
  upsertUserProjectMemory,
  isUserProjectMemoryType,
  type UserProjectMemoryType,
} from "@/lib/memory";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ projectKey: string; userId: string }> }
) {
  const { projectKey, userId } = await params;
  const typeParam = req.nextUrl.searchParams.get("type");

  let type: UserProjectMemoryType | undefined;
  if (typeParam !== null) {
    if (!isUserProjectMemoryType(typeParam)) {
      return NextResponse.json(
        { error: `Invalid type "${typeParam}"` },
        { status: 400 }
      );
    }
    type = typeParam;
  }

  const entries = await getUserProjectMemory(
    projectKey,
    userId,
    type ? { type } : {}
  );
  return NextResponse.json(entries);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectKey: string; userId: string }> }
) {
  const { projectKey, userId } = await params;
  const body = await req.json();
  const { key, type, content, sourceAgent } = body;

  if (!key || typeof key !== "string") {
    return NextResponse.json(
      { error: "key is required" },
      { status: 400 }
    );
  }
  if (!isUserProjectMemoryType(type)) {
    return NextResponse.json(
      { error: `Invalid or missing type. Must be one of capability, preferences, decision_style, private_notes` },
      { status: 400 }
    );
  }
  if (typeof content !== "string") {
    return NextResponse.json(
      { error: "content must be a string" },
      { status: 400 }
    );
  }

  const entry = await upsertUserProjectMemory(projectKey, userId, {
    key,
    type,
    content,
    sourceAgent: sourceAgent ?? null,
  });
  return NextResponse.json(entry, { status: 200 });
}
