import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { updateExperimentRun, parseGuardrailDefs } from "@/lib/data";
import { runAnalysis } from "@/lib/stats/analyze";
import { runBanditAnalysis } from "@/lib/stats/bandit";
import { queryAllMetrics } from "@/lib/stats/track-client";
import { fetchFromCustomerEndpoint } from "@/lib/stats/customer-endpoint-fetcher";
import { requireAuth } from "@/lib/server-auth/guard";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

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
  const isCustomerMode =
    run.dataSourceMode === "customer-single" || run.dataSourceMode === "customer-per-metric";
  if (!isCustomerMode && !canLiveFetch && !hasStoredInputData) {
    return NextResponse.json(
      {
        error:
          "No data available: configure flag (featbitEnvId + flagKey), paste observed data in expert setup, or set up a Customer Managed Data Endpoint.",
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

  // ── Step 1: Obtain per-variant stats ────────────────────────────────────────
  // Three data-source paths (selected by ExperimentRun.dataSourceMode):
  //   "customer-single"     → Customer Managed Data Endpoint, single endpoint
  //   "customer-per-metric" → Customer Managed Data Endpoint, per-metric routing
  //   "featbit-managed"     → FeatBit-managed track-service (default; legacy)
  //   "manual"/"external-text"/null → no live fetch; stored inputData fallback only
  type MetricsDict = Record<string, Record<string, Record<string, number>>>;
  let metrics: MetricsDict | null = null;
  let dataSource: "live" | "customer" | "stored" = "live";
  let customerError: string | null = null;

  // Narrow Prisma's `string | null` to MetricSpec's canonical literal union.
  // Run rows always have a value (DB default 'binary' / 'once'); a missing
  // value means a row predating the column — fall back to the same default.
  const narrowType = (v: string | null | undefined): "binary" | "continuous" =>
    v === "continuous" ? "continuous" : "binary";
  const narrowAgg = (v: string | null | undefined): "once" | "count" | "sum" | "average" =>
    v === "count" || v === "sum" || v === "average" ? v : "once";

  const dataSourceMode = run.dataSourceMode ?? "featbit-managed";

  if (isCustomerMode) {
    const result = await fetchFromCustomerEndpoint(
      dataSourceMode,
      run.customerEndpointConfig,
      {
        experimentId:   experiment.id,
        flagKey:        flagKey ?? "",
        envId:          envId ?? "",
        variants:       [controlVariant, ...treatments],
        windowStart:    start.toISOString(),
        windowEnd:      end.toISOString(),
        experimentMode: method === "bandit" ? "bandit" : "ab",
        primary: {
          name:    run.primaryMetricEvent,
          role:    method === "bandit" ? "reward" : "primary",
          type:    narrowType(run.primaryMetricType),
          agg:     narrowAgg(run.primaryMetricAgg),
        },
        guardrails: method === "bandit" ? [] : guardrailDefs.map((g) => ({
          name:    g.event,
          role:    "guardrail" as const,
          type:    narrowType(g.metricType),
          agg:     narrowAgg(g.metricAgg),
          inverse: g.inverse,
        })),
      },
    );
    if (result.ok) {
      metrics = result.metrics;
      dataSource = "customer";
    } else {
      customerError = result.error;
    }
  } else if (canLiveFetch) {
    metrics = (await queryAllMetrics({
      envId: envId as string,
      flagKey: flagKey as string,
      startDate,
      endDate,
      // Pass the run's declared metricType / metricAgg through to track-service
      // so the SQL aggregates per the user's intent and the response shape
      // matches what the analyzer expects.
      primary: {
        event:      run.primaryMetricEvent,
        metricType: narrowType(run.primaryMetricType),
        metricAgg:  narrowAgg(run.primaryMetricAgg),
      },
      guardrails: guardrailDefs.map((g) => ({
        event:      g.event,
        metricType: narrowType(g.metricType),
        metricAgg:  narrowAgg(g.metricAgg),
      })),
    })) as MetricsDict | null;
  }

  // Customer-endpoint failure surfaces immediately — falling back to stored
  // data would silently mask a misconfigured warehouse, since the operator
  // explicitly chose customer-managed and would be looking at stale numbers
  // without knowing it.
  if (isCustomerMode && !metrics) {
    return NextResponse.json(
      { error: `Customer endpoint fetch failed: ${customerError ?? "unknown error"}` },
      { status: 503 },
    );
  }

  if (!metrics) {
    // Live (track-service) fetch didn't work or wasn't possible. Fall back
    // to stored data — only valid for the FeatBit-managed / manual paths.
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
