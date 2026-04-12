import { NextRequest, NextResponse } from "next/server";
import { getExperiment, createExperimentRun, updateExperimentRun } from "@/lib/data";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const slug = req.nextUrl.searchParams.get("slug");

  if (!slug) {
    return NextResponse.json(
      { error: "slug query parameter is required" },
      { status: 400 }
    );
  }

  const experiment = await getExperiment(id);
  if (!experiment) {
    return NextResponse.json({ error: "Experiment not found" }, { status: 404 });
  }

  const run = experiment.experimentRuns.find((e) => e.slug === slug);
  if (!run) {
    return NextResponse.json(
      { error: `Experiment run '${slug}' not found` },
      { status: 404 }
    );
  }

  return NextResponse.json(run);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const { slug, ...rest } = body;

  if (!slug) {
    return NextResponse.json(
      { error: "slug is required" },
      { status: 400 }
    );
  }

  const experiment = await getExperiment(id);
  if (!experiment) {
    return NextResponse.json({ error: "Experiment not found" }, { status: 404 });
  }

  // Upsert: update if exists, create if not
  const existing = experiment.experimentRuns.find((e) => e.slug === slug);
  if (existing) {
    const updated = await updateExperimentRun(existing.id, rest);
    return NextResponse.json(updated);
  }

  const run = await createExperimentRun(id, { slug, ...rest });
  return NextResponse.json(run, { status: 201 });
}
