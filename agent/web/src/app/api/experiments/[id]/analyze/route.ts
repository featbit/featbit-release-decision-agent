import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { updateExperimentRun } from "@/lib/data";

const DATA_SERVER_URL =
  process.env.DATA_SERVER_URL ?? "http://localhost:5058";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: experimentId } = await params;
  const body = await req.json();
  const { runId } = body as { runId?: string };

  if (!runId) {
    return NextResponse.json(
      { error: "runId is required" },
      { status: 400 }
    );
  }

  // Look up experiment run + parent experiment
  const run = await prisma.experimentRun.findUnique({
    where: { id: runId },
    include: {
      experiment: {
        select: {
          id: true,
          flagKey: true,
          envSecret: true,
        },
      },
    },
  });

  if (!run || run.experimentId !== experimentId) {
    return NextResponse.json(
      { error: "Experiment run not found" },
      { status: 404 }
    );
  }

  const { experiment } = run;
  const envId = experiment.envSecret;
  const flagKey = experiment.flagKey;

  if (!envId || !flagKey || !run.primaryMetricEvent) {
    return NextResponse.json(
      { error: "Missing required fields: envSecret, flagKey, or primaryMetricEvent" },
      { status: 400 }
    );
  }

  // Build the request for the .NET /analyze endpoint
  const analyzePayload = {
    slug: run.slug,
    projectId: run.experimentId,
    experimentId: run.id,
    envId,
    flagKey,
    method: run.method ?? "bayesian_ab",
    layerId: run.layerId,
    trafficPercent: run.trafficPercent,
    trafficOffset: run.trafficOffset,
    audienceFilters: run.audienceFilters,
    primaryMetricEvent: run.primaryMetricEvent,
    primaryMetricType: run.primaryMetricType ?? "binary",
    primaryMetricAgg: run.primaryMetricAgg ?? "once",
    controlVariant: run.controlVariant ?? "false",
    treatmentVariant: run.treatmentVariant ?? "true",
    observationStart: run.observationStart?.toISOString(),
    observationEnd: run.observationEnd?.toISOString(),
    priorProper: run.priorProper ?? false,
    priorMean: run.priorMean ?? 0.0,
    priorStddev: run.priorStddev ?? 0.3,
    minimumSample: run.minimumSample ?? 0,
    guardrailEvents: run.guardrailEvents,
  };

  // Call .NET data server
  let analyzeResult: { inputData?: string; analysisResult?: string; error?: string };
  try {
    const resp = await fetch(`${DATA_SERVER_URL}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(analyzePayload),
    });
    analyzeResult = await resp.json();
    if (!resp.ok && resp.status !== 200) {
      return NextResponse.json(
        { error: analyzeResult.error ?? "Analysis failed" },
        { status: resp.status }
      );
    }
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to reach data server: ${(err as Error).message}` },
      { status: 502 }
    );
  }

  // Save inputData + analysisResult back to the experiment run
  const updateData: Record<string, unknown> = {};
  if (analyzeResult.inputData) {
    updateData.inputData = analyzeResult.inputData;
  }
  if (analyzeResult.analysisResult) {
    updateData.analysisResult = analyzeResult.analysisResult;
  }

  if (Object.keys(updateData).length > 0) {
    await updateExperimentRun(runId, updateData);
  }

  return NextResponse.json({
    inputData: analyzeResult.inputData ?? null,
    analysisResult: analyzeResult.analysisResult ?? null,
  });
}
