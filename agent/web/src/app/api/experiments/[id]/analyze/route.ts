import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { updateExperimentRun } from "@/lib/data";
import { runAnalysis } from "@/lib/stats/analyze";
import { runBanditAnalysis } from "@/lib/stats/bandit";
import { collectManyMetrics, collectMetric } from "@/lib/stats/tsdb-client";
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
  const primaryMetricEvent = run.primaryMetricEvent;
  const treatments = (run.treatmentVariant ?? "true")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const treatmentVariant = treatments[0] ?? "true";
  const now = new Date();
  const start = run.observationStart?.toISOString() ?? new Date(now.getTime() - 30 * 86400000).toISOString();
  const end = run.observationEnd?.toISOString() ?? now.toISOString();
  const method = run.method ?? "bayesian_ab";

  let guardrailEventNames: string[] = [];
  if (run.guardrailEvents && method !== "bandit") {
    try {
      const parsed = JSON.parse(run.guardrailEvents);
      if (Array.isArray(parsed)) {
        guardrailEventNames = parsed.filter(
          (value): value is string => typeof value === "string" && value.length > 0,
        );
      }
    } catch {
      // ignore malformed JSON
    }
  }

  const sharedQueryParams = {
    envId,
    flagKey,
    metricEvent: primaryMetricEvent,
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
  };

  // ── Step 1: Collect primary metric and guardrails from TSDB ──
  const batchSummaries = method !== "bandit"
    ? await collectManyMetrics({
        ...sharedQueryParams,
        guardrailEvents: guardrailEventNames,
      })
    : null;

  const primarySummary = batchSummaries?.[primaryMetricEvent]
    ?? await collectMetric(sharedQueryParams);

  if (!primarySummary) {
    if (run.inputData && run.analysisResult) {
      return NextResponse.json({
        inputData: run.inputData,
        analysisResult: run.analysisResult,
        stale: true,
        warning: "TSDB is temporarily unavailable, showing the last successful analysis.",
      });
    }

    return NextResponse.json(
      { error: "No data returned from TSDB" },
      { status: 503 }
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

  const guardrailSummaries: Record<string, MetricSummary> = {};
  for (const gEvent of guardrailEventNames) {
    const summary = batchSummaries?.[gEvent];
    if (summary) {
      guardrailSummaries[gEvent] = summary;
      continue;
    }

    const fallbackSummary = await collectMetric({
      ...sharedQueryParams,
      metricEvent: gEvent,
      metricType: "binary",
      metricAgg: "once",
    });

    if (fallbackSummary) {
      guardrailSummaries[gEvent] = fallbackSummary;
    }
  }

  // ── Step 3: Build metrics map ──
  const metrics: Record<string, Record<string, unknown>> = {
    [primaryMetricEvent]: {
      [controlVariant]: primarySummary.control,
      [treatmentVariant]: primarySummary.treatment,
    },
  };

  // For bandit mode we support multi-arm by querying each treatment arm.
  if (method === "bandit" && treatments.length > 1) {
    const extraArmEntries = await Promise.all(
      treatments.slice(1).map(async (arm) => {
        const extra = await collectMetric({
          envId,
          flagKey,
          metricEvent: primaryMetricEvent,
          metricType: run.primaryMetricType ?? "binary",
          metricAgg: run.primaryMetricAgg ?? "once",
          controlVariant,
          treatmentVariant: arm,
          start,
          end,
          experimentId: experiment.id,
          layerId: run.layerId ?? undefined,
          trafficPercent: run.trafficPercent ?? undefined,
          trafficOffset: run.trafficOffset ?? undefined,
          audienceFilters: run.audienceFilters ?? undefined,
          method,
        });
        return extra ? ([arm, extra] as const) : null;
      }),
    );

    for (const entry of extraArmEntries) {
      if (entry) {
        const [arm, extra] = entry;
        metrics[primaryMetricEvent][arm] = extra.treatment;
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
        metricEvent: primaryMetricEvent,
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
