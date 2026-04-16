import { NextRequest, NextResponse } from "next/server";
import { updateExperimentStage, getExperiment } from "@/lib/data";

const VALID_STAGES = new Set([
  "intent",
  "hypothesis",
  "implementing",
  "measuring",
  "learning",
]);

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const { stage } = body;

  if (!stage || !VALID_STAGES.has(stage)) {
    return NextResponse.json(
      { error: `Invalid stage. Must be one of: ${[...VALID_STAGES].join(", ")}` },
      { status: 400 }
    );
  }

  const experiment = await getExperiment(id);
  if (!experiment) {
    return NextResponse.json({ error: "Experiment not found" }, { status: 404 });
  }

  const updated = await updateExperimentStage(id, stage);
  return NextResponse.json(updated);
}
