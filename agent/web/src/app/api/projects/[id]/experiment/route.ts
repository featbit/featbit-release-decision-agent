import { NextRequest, NextResponse } from "next/server";
import { getProject, createExperiment, updateExperiment } from "@/lib/data";

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

  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const experiment = project.experiments.find((e) => e.slug === slug);
  if (!experiment) {
    return NextResponse.json(
      { error: `Experiment '${slug}' not found` },
      { status: 404 }
    );
  }

  return NextResponse.json(experiment);
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

  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // Upsert: update if exists, create if not
  const existing = project.experiments.find((e) => e.slug === slug);
  if (existing) {
    const updated = await updateExperiment(existing.id, rest);
    return NextResponse.json(updated);
  }

  const experiment = await createExperiment(id, { slug, ...rest });
  return NextResponse.json(experiment, { status: 201 });
}
