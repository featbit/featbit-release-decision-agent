import { NextRequest, NextResponse } from "next/server";
import { updateProjectStage, getProject } from "@/lib/data";

const VALID_STAGES = new Set([
  "intent",
  "hypothesis",
  "implementing",
  "measuring",
  "deciding",
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

  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const updated = await updateProjectStage(id, stage);
  return NextResponse.json(updated);
}
