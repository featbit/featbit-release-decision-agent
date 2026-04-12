import { NextRequest, NextResponse } from "next/server";
import { updateExperiment, getExperiment } from "@/lib/data";

const ALLOWED_FIELDS = new Set([
  "goal",
  "intent",
  "hypothesis",
  "change",
  "variants",
  "primaryMetric",
  "guardrails",
  "constraints",
  "conflictAnalysis",
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

  const experiment = await getExperiment(id);
  if (!experiment) {
    return NextResponse.json({ error: "Experiment not found" }, { status: 404 });
  }

  const updated = await updateExperiment(id, data);
  return NextResponse.json(updated);
}
