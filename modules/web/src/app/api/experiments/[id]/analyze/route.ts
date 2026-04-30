import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { updateExperimentRun, parseGuardrailDefs } from "@/lib/data";
import { runAnalysis } from "@/lib/stats/analyze";
import { runBanditAnalysis } from "@/lib/stats/bandit";
import { queryAllMetrics } from "@/lib/stats/track-client";

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
          variants: true,
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
  const canLiveFetch = !!(envId && flagKey && run.primaryMetricEvent);
  const hasStoredInputData = !!run.inputData;

  if (!run.primaryMetricEvent) {
    return NextResponse.json(
      { error: "Missing required fields: primaryMetricEvent" },
      { status: 400 }
    );
  }
  if (!canLiveFetch && !hasStoredInputData) {
    return NextResponse.json(
      {
        error:
          "No data available: either configure flag (featbitEnvId + flagKey) or paste observed data in expert setup.",
      },
      { status: 400 }
    );
  }

  let controlVariant = run.controlVariant ?? "false";
  let treatments = (run.treatmentVariant ?? "true")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const now = new Date();
  const start = run.observationStart ?? new Date(now.getTime() - 30 * 86400000);
  const end = run.observationEnd ?? now;
  const startDate = start.toISOString().slice(0, 10);
  const endDate = end.toISOString().slice(0, 10);
  const method = run.method ?? "bayesian_ab";

  // Parse guardrail definitions. parseGuardrailDefs accepts both legacy
  // string[] (event names only) and the canonical GuardrailDef[] shape with
  // metricType / metricAgg / inverse, so the analyzer honours each guardrail's
  // declared aggregation and direction even on the live-data path.
  const guardrailDefs = parseGuardrailDefs(run.guardrailEvents);
  const guardrailEventNames = guardrailDefs.map((g) => g.event);

  // ── Step 1: Obtain per-variant stats ────────────────────────────────────────
  // Prefer live track-service fetch when the flag is wired up. Fall back to
  // stored inputData for "expert setup" experiments where the user pasted
  // totals and there is no FeatBit flag to query yet.
  type MetricsDict = Record<string, Record<string, Record<string, number>>>;
  let metrics: MetricsDict | null = null;
  let dataSource: "live" | "stored" = "live";

  if (canLiveFetch) {
    metrics = (await queryAllMetrics({
      envId: envId as string,
      flagKey: flagKey as string,
      startDate,
      endDate,
      primaryMetricEvent: run.primaryMetricEvent,
      guardrailEvents: guardrailEventNames,
    })) as MetricsDict | null;
  }

  if (!metrics) {
    // Live fetch didn't work (or wasn't possible). Fall back to stored data.
    if (hasStoredInputData) {
      try {
        const parsed = JSON.parse(run.inputData as string);
        if (parsed && typeof parsed === "object" && parsed.metrics) {
          metrics = parsed.metrics as MetricsDict;
          dataSource = "stored";
        }
      } catch {/* ignore */}
    }
  }

  if (!metrics) {
    if (canLiveFetch && forceFresh) {
      return NextResponse.json(
        { error: "Failed to fetch data from track-service. Is it running?" },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { error: "No data available for analysis" },
      { status: 503 }
    );
  }

  // Check that at least some data exists. `status: "no_data"` is a normal
  // state (experiment just started / instrumentation not firing yet), not
  // an error — the client renders it as an info card, not a red message.
  const primaryData = metrics[run.primaryMetricEvent] as Record<string, Record<string, number>> | undefined;
  if (!primaryData || Object.keys(primaryData).length === 0) {
    return NextResponse.json({ status: "no_data", reason: "no_primary_metric_rows" });
  }
  const totalUsers = Object.values(primaryData)
    .filter((v) => typeof v === "object" && v !== null && "n" in v)
    .reduce((sum, v) => sum + ((v as Record<string, number>).n ?? 0), 0);
  if (totalUsers === 0) {
    return NextResponse.json({ status: "no_data", reason: "zero_users" });
  }

  // ── Auto-correct variant keys if configured names don't match actual data ─────
  // controlVariant / treatmentVariant store FeatBit variation KEYS (e.g. "variation-a")
  // but ClickHouse records the variation VALUE (e.g. "Cut Feature Flag Infra Costs…").
  // If none of the configured names appear in primaryData, do a positional remap so
  // analysis can proceed without manual intervention.
  {
    const actualKeys = Object.keys(primaryData).sort();
    const configured = [controlVariant, ...treatments];
    const noneMatch = configured.every((v) => !actualKeys.includes(v));

    if (noneMatch && actualKeys.length === configured.length) {
      // Sort both sides, map by index (variation-a → 1st actual, variation-b → 2nd actual, …)
      const sortedConfigured = [...configured].sort();
      const newControl = actualKeys[sortedConfigured.indexOf(controlVariant)];
      const newTreatments = treatments.map((t) => actualKeys[sortedConfigured.indexOf(t)]);

      if (newControl !== undefined && newTreatments.every((v) => v !== undefined)) {
        await prisma.experimentRun.update({
          where: { id: runId },
          data: {
            controlVariant: newControl,
            treatmentVariant: newTreatments.join(","),
          },
        });
        controlVariant = newControl;
        treatments = newTreatments;
      }
    }
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
        guardrails: guardrailDefs.length > 0 ? guardrailDefs : undefined,
        primaryMetricAgg: run.primaryMetricAgg ?? undefined,
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
    dataSource,
  });
}
