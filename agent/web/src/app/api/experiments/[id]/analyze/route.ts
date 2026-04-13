import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { updateExperimentRun } from "@/lib/data";
import { runAnalysis } from "@/lib/stats/analyze";
import { runBanditAnalysis } from "@/lib/stats/bandit";
import { collectMetric } from "@/lib/stats/tsdb-client";
import type { MetricSummary } from "@/lib/stats/types";

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

  const controlVariant = run.controlVariant ?? "false";
  const treatments = (run.treatmentVariant ?? "true")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const treatmentVariant = treatments[0] ?? "true";
  const now = new Date();
  const start = run.observationStart?.toISOString() ?? new Date(now.getTime() - 30 * 86400000).toISOString();
  const end = run.observationEnd?.toISOString() ?? now.toISOString();
  const method = run.method ?? "bayesian_ab";

  // ── Step 1: Collect primary metric from TSDB ──
  const primarySummary = await collectMetric({
    envId,
    flagKey,
    metricEvent: run.primaryMetricEvent,
    metricType: run.primaryMetricType ?? "binary",
    metricAgg: run.primaryMetricAgg ?? "once",
    controlVariant,
    treatmentVariant,
    start,
    end,
    experimentId: experiment.id,
    layerId: run.layerId ?? undefined,
    trafficPercent: run.trafficPercent ?? undefined,
    trafficOffset: run.trafficOffset ?? undefined,
    audienceFilters: run.audienceFilters ?? undefined,
    method,
  });

  if (!primarySummary) {
    return NextResponse.json(
      { error: "No data returned from TSDB" },
      { status: 502 }
    );
  }

  const controlN = (primarySummary.control as { n: number }).n ?? 0;
  const treatmentN = (primarySummary.treatment as { n: number }).n ?? 0;
  if (controlN === 0 && treatmentN === 0) {
    return NextResponse.json({
      error: "No users collected yet",
      inputData: null,
    });
  }

  // ── Step 2: Collect guardrail metrics (Bayesian only) ──
  let guardrailEventNames: string[] = [];
  if (run.guardrailEvents && method !== "bandit") {
    try {
      const parsed = JSON.parse(run.guardrailEvents);
      if (Array.isArray(parsed)) guardrailEventNames = parsed;
    } catch { /* ignore malformed JSON */ }
  }

  const guardrailSummaries: Record<string, MetricSummary> = {};
  for (const gEvent of guardrailEventNames) {
    const gs = await collectMetric({
      envId,
      flagKey,
      metricEvent: gEvent,
      metricType: "binary",
      metricAgg: "once",
      controlVariant,
      treatmentVariant,
      start,
      end,
      experimentId: run.id,
      layerId: run.layerId ?? undefined,
      trafficPercent: run.trafficPercent ?? undefined,
      trafficOffset: run.trafficOffset ?? undefined,
      audienceFilters: run.audienceFilters ?? undefined,
      method,
    });
    if (gs) guardrailSummaries[gEvent] = gs;
  }

  // ── Step 3: Build metrics map ──
  const metrics: Record<string, Record<string, unknown>> = {
    [run.primaryMetricEvent]: {
      [controlVariant]: primarySummary.control,
      [treatmentVariant]: primarySummary.treatment,
    },
  };

  // For bandit mode we support multi-arm by querying each treatment arm.
  if (method === "bandit" && treatments.length > 1) {
    for (const arm of treatments.slice(1)) {
      const extra = await collectMetric({
        envId,
        flagKey,
        metricEvent: run.primaryMetricEvent,
        metricType: run.primaryMetricType ?? "binary",
        metricAgg: run.primaryMetricAgg ?? "once",
        controlVariant,
        treatmentVariant: arm,
        start,
        end,
        experimentId: run.id,
        layerId: run.layerId ?? undefined,
        trafficPercent: run.trafficPercent ?? undefined,
        trafficOffset: run.trafficOffset ?? undefined,
        audienceFilters: run.audienceFilters ?? undefined,
        method,
      });
      if (extra) {
        metrics[run.primaryMetricEvent][arm] = extra.treatment;
      }
    }
  }

  for (const [gEvent, gs] of Object.entries(guardrailSummaries)) {
    metrics[gEvent] = {
      [controlVariant]: gs.control,
      [treatmentVariant]: gs.treatment,
    };
  }

  const inputData = JSON.stringify({ metrics });

  // ── Step 4: Run local TypeScript analysis ──
  const analysisResult = method === "bandit"
    ? runBanditAnalysis({
        slug: run.slug ?? "on-demand",
        metricEvent: run.primaryMetricEvent,
        metrics,
        control: controlVariant,
        treatments,
        observationStart: start,
        observationEnd: end,
        priorProper: run.priorProper ?? false,
        priorMean: run.priorMean ?? 0,
        priorStddev: run.priorStddev ?? 0.3,
      })
    : runAnalysis({
        slug: run.slug ?? "on-demand",
        metrics,
        control: controlVariant,
        treatments: [treatmentVariant],
        observationStart: start,
        observationEnd: end,
        priorProper: run.priorProper ?? false,
        priorMean: run.priorMean ?? 0,
        priorStddev: run.priorStddev ?? 0.3,
        minimumSample: run.minimumSample ?? 0,
        guardrailEvents: guardrailEventNames.length > 0 ? guardrailEventNames : undefined,
      });

  const analysisResultJson = JSON.stringify(analysisResult);

  // Save inputData + analysisResult back to the experiment run
  const updateData: Record<string, unknown> = {
    inputData,
    analysisResult: analysisResultJson,
  };
  await updateExperimentRun(runId, updateData);

  return NextResponse.json({
    inputData,
    analysisResult: analysisResultJson,
  });
}
