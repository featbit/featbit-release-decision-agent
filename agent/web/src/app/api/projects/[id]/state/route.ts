import { NextRequest, NextResponse } from "next/server";
import { updateProject, getProject } from "@/lib/data";

const ALLOWED_FIELDS = new Set([
  "goal",
  "intent",
  "hypothesis",
  "change",
  "variants",
  "primaryMetric",
  "guardrails",
  "constraints",
  "openQuestions",
  "lastAction",
  "lastLearning",
  "flagKey",
]);

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();

  // Only allow known state fields
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (ALLOWED_FIELDS.has(key)) {
      data[key] = value;
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { error: "No valid state fields provided" },
      { status: 400 }
    );
  }

  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const updated = await updateProject(id, data);
  return NextResponse.json(updated);
}
