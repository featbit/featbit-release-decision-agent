import { NextRequest, NextResponse } from "next/server";
import { getExperiment, createExperimentRun, updateExperimentRun } from "@/lib/data";

const VALID_RUN_STATUSES = new Set(["draft", "collecting", "analyzing", "decided", "archived"]);
const VALID_METHODS = new Set(["bayesian_ab", "frequentist", "bandit"]);
const VALID_DECISIONS = new Set(["CONTINUE", "PAUSE", "ROLLBACK", "INCONCLUSIVE"]);
const VALID_METRIC_TYPES = new Set(["binary", "continuous"]);
const VALID_METRIC_AGG = new Set(["once", "sum", "last"]);

function validateRunFields(fields: Record<string, unknown>): string | null {
  if (fields.status !== undefined && !VALID_RUN_STATUSES.has(fields.status as string))
    return `Invalid status "${fields.status}". Valid: ${[...VALID_RUN_STATUSES].join(" | ")}`;
  if (fields.method !== undefined && !VALID_METHODS.has(fields.method as string))
    return `Invalid method "${fields.method}". Valid: ${[...VALID_METHODS].join(" | ")}`;
  if (fields.decision !== undefined && !VALID_DECISIONS.has(fields.decision as string))
    return `Invalid decision "${fields.decision}". Valid: ${[...VALID_DECISIONS].join(" | ")}`;
  if (fields.primaryMetricType !== undefined && !VALID_METRIC_TYPES.has(fields.primaryMetricType as string))
    return `Invalid primaryMetricType "${fields.primaryMetricType}". Valid: ${[...VALID_METRIC_TYPES].join(" | ")}`;
  if (fields.primaryMetricAgg !== undefined && !VALID_METRIC_AGG.has(fields.primaryMetricAgg as string))
    return `Invalid primaryMetricAgg "${fields.primaryMetricAgg}". Valid: ${[...VALID_METRIC_AGG].join(" | ")}`;
  return null;
}

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

  const validationError = validateRunFields(rest);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
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
