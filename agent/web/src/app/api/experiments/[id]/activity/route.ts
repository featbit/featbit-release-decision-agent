import { NextRequest, NextResponse } from "next/server";
import { addActivity, getExperiment } from "@/lib/data";

const VALID_ACTIVITY_TYPES = new Set([
  "stage_update",
  "field_update",
  "run_created",
  "run_started",
  "run_paused",
  "run_completed",
  "decision_recorded",
  "learning_captured",
]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const { type, title, detail } = body;

  if (!type || !title) {
    return NextResponse.json(
      { error: "type and title are required" },
      { status: 400 }
    );
  }

  if (!VALID_ACTIVITY_TYPES.has(type)) {
    return NextResponse.json(
      { error: `Invalid activity type "${type}". Valid: ${[...VALID_ACTIVITY_TYPES].join(" | ")}` },
      { status: 400 }
    );
  }

  const experiment = await getExperiment(id);
  if (!experiment) {
    return NextResponse.json({ error: "Experiment not found" }, { status: 404 });
  }

  const activity = await addActivity(id, { type, title, detail });
  return NextResponse.json(activity, { status: 201 });
}
