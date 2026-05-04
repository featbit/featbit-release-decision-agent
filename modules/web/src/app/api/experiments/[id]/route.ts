import { NextRequest, NextResponse } from "next/server";
import { getExperiment } from "@/lib/data";
import { requireAuthForExperiment } from "@/lib/server-auth/guard";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await requireAuthForExperiment(req, id);
  if (auth instanceof NextResponse) return auth;

  const experiment = await getExperiment(id);
  if (!experiment) {
    return NextResponse.json({ error: "Experiment not found" }, { status: 404 });
  }
  return NextResponse.json(experiment);
}
