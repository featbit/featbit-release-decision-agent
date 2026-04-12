import { NextRequest, NextResponse } from "next/server";
import { addActivity, getExperiment } from "@/lib/data";

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

  const experiment = await getExperiment(id);
  if (!experiment) {
    return NextResponse.json({ error: "Experiment not found" }, { status: 404 });
  }

  const activity = await addActivity(id, { type, title, detail });
  return NextResponse.json(activity, { status: 201 });
}
