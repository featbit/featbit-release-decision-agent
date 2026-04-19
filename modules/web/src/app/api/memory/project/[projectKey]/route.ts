import { NextRequest, NextResponse } from "next/server";
import {
  getProjectMemory,
  upsertProjectMemory,
  isProjectMemoryType,
  type ProjectMemoryType,
} from "@/lib/memory";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ projectKey: string }> }
) {
  const { projectKey } = await params;
  const typeParam = req.nextUrl.searchParams.get("type");

  let type: ProjectMemoryType | undefined;
  if (typeParam !== null) {
    if (!isProjectMemoryType(typeParam)) {
      return NextResponse.json(
        { error: `Invalid type "${typeParam}"` },
        { status: 400 }
      );
    }
    type = typeParam;
  }

  const entries = await getProjectMemory(projectKey, type ? { type } : {});
  return NextResponse.json(entries);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectKey: string }> }
) {
  const { projectKey } = await params;
  const body = await req.json();
  const { key, type, content, sourceAgent, createdByUserId, editable } = body;

  if (!key || typeof key !== "string") {
    return NextResponse.json(
      { error: "key is required" },
      { status: 400 }
    );
  }
  if (!isProjectMemoryType(type)) {
    return NextResponse.json(
      { error: `Invalid or missing type. Must be one of product_facts, goals, learnings, constraints, glossary` },
      { status: 400 }
    );
  }
  if (typeof content !== "string") {
    return NextResponse.json(
      { error: "content must be a string" },
      { status: 400 }
    );
  }

  const entry = await upsertProjectMemory(projectKey, {
    key,
    type,
    content,
    sourceAgent: sourceAgent ?? null,
    createdByUserId: createdByUserId ?? null,
    editable: typeof editable === "boolean" ? editable : undefined,
  });
  return NextResponse.json(entry, { status: 200 });
}
