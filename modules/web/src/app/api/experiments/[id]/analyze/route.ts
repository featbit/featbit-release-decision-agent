import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { updateExperimentRun } from "@/lib/data";
import { runAnalysis } from "@/lib/stats/analyze";
import { runBanditAnalysis } from "@/lib/stats/bandit";
import { queryAllMetrics, queryMetric } from "@/lib/stats/track-client";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: experimentId } = await params;
  const body = await req.json();
  const { runId, forceFresh } = body as { runId?: string; forceFresh?: boolean };

  if (!runId) {
    return NextResponse.json(
      { error: "runId is required" },
      { status: 400 }
    );
  }

  // ── Load experiment run + parent experiment ─────────────────────────────────
  const run = await prisma.experimentRun.findUnique({
    where: { id: runId },
    include: {
      experiment: {
        select: {
          id: true,
          flagKey: true,
          featbitEnvId: true,
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
  const envId = experiment.featbitEnvId;
  const flagKey = experiment.flagKey;

  if (!envId || !flagKey || !run.primaryMetricEvent) {
    return NextResponse.json(
      { error: "Missing required fields: featbitEnvId, flagKey, or primaryMetricEvent" },
      { status: 400 }
    );
  }

  const controlVariant = run.controlVariant ?? "false";
  const treatments = (run.treatmentVariant ?? "true")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const now = new Date();
  const start = run.observationStart ?? new Date(now.getTime() - 30 * 86400000);
  const end = run.observationEnd ?? now;
  const startDate = start.toISOString().slice(0, 10);
  const endDate = end.toISOString().slice(0, 10);
  const method = run.method ?? "bayesian_ab";

  // Parse guardrail event names
  let guardrailEventNames: string[] = [];
  if (run.guardrailEvents) {
    try {
      const parsed = JSON.parse(run.guardrailEvents);
      if (Array.isArray(parsed)) {
        guardrailEventNames = parsed.filter(
          (v): v is string => typeof v === "string" && v.length > 0,
        );
      }
    } catch {
      // comma-separated fallback
      guardrailEventNames = run.guardrailEvents
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }

  // ── Step 1: Query track-service for per-variant stats ───────────────────────
  const metrics = await queryAllMetrics({
    envId,
    flagKey,
    startDate,
    endDate,
    primaryMetricEvent: run.primaryMetricEvent,
    guardrailEvents: guardrailEventNames,
  });

  if (!metrics) {
    if (forceFresh) {
      return NextResponse.json(
        { error: "Failed to fetch data from track-service. Is it running?" },
        { status: 503 }
      );
    }
    // Return stale cached result if available
    if (run.inputData && run.analysisResult) {
      return NextResponse.json({
        inputData: run.inputData,
        analysisResult: run.analysisResult,
        stale: true,
        warning: "track-service is temporarily unavailable, showing the last successful analysis.",
      });
    }
    return NextResponse.json(
      { error: "No data returned from track-service" },
      { status: 503 }
    );
  }

  // Check that at least some data exists
  const primaryData = metrics[run.primaryMetricEvent] as Record<string, Record<string, number>> | undefined;
  if (!primaryData) {
    return NextResponse.json({ error: "No primary metric data found", inputData: null });
  }
  const totalUsers = Object.values(primaryData)
    .filter((v) => typeof v === "object" && v !== null && "n" in v)
    .reduce((sum, v) => sum + ((v as Record<string, number>).n ?? 0), 0);
  if (totalUsers === 0) {
    return NextResponse.json({ error: "No users collected yet", inputData: null });
  }

  // For bandit with multi-arm: track-service already returns all variants in one query
  // (unlike old TSDB which needed separate queries per arm), so metrics map is complete.

  const inputData = JSON.stringify({ metrics });

  // ── Step 2: Run local analysis ──────────────────────────────────────────────
  const analysisResult = method === "bandit"
    ? runBanditAnalysis({
        slug: run.slug ?? "on-demand",
        metricEvent: run.primaryMetricEvent,
        metrics,
        control: controlVariant,
        treatments,
        observationStart: startDate,
        observationEnd: endDate,
        priorProper: run.priorProper ?? false,
        priorMean: run.priorMean ?? 0,
        priorStddev: run.priorStddev ?? 0.3,
      })
    : runAnalysis({
        slug: run.slug ?? "on-demand",
        metrics,
        control: controlVariant,
        treatments,
        observationStart: startDate,
        observationEnd: endDate,
        priorProper: run.priorProper ?? false,
        priorMean: run.priorMean ?? 0,
        priorStddev: run.priorStddev ?? 0.3,
        minimumSample: run.minimumSample ?? 0,
        guardrailEvents: guardrailEventNames.length > 0 ? guardrailEventNames : undefined,
      });

  const analysisResultJson = JSON.stringify(analysisResult);

  // ── Step 3: Save results ────────────────────────────────────────────────────
  await updateExperimentRun(runId, {
    inputData,
    analysisResult: analysisResultJson,
  });

  return NextResponse.json({
    inputData,
    analysisResult: analysisResultJson,
  });
}
