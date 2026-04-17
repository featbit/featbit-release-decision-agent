import { NextRequest, NextResponse } from "next/server";
import { getExperiment } from "@/lib/data";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/experiments/[id]/conflicts
 *
 * Scans all other active experiments (non-learning stage) and their running
 * experiment runs to detect potential conflicts with the given experiment.
 *
 * Conflict dimensions:
 *  1. Flag key overlap — same feature flag used by another active experiment
 *  2. Audience overlap — overlapping audience filters / traffic segments
 *  3. Metric interference — shared primary metric could pollute attribution
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const experiment = await getExperiment(id);
  if (!experiment) {
    return NextResponse.json({ error: "Experiment not found" }, { status: 404 });
  }

  // Find all other experiments that are NOT in learning stage and NOT this one
  const others = await prisma.experiment.findMany({
    where: {
      id: { not: id },
      stage: { not: "learning" },
    },
    include: {
      experimentRuns: {
        where: { status: { in: ["draft", "collecting", "analyzing"] } },
      },
    },
  });

  const conflicts: Array<{
    experimentId: string;
    experimentName: string;
    stage: string;
    dimensions: string[];
    details: string[];
    severity: "high" | "medium" | "low";
  }> = [];

  for (const other of others) {
    const dimensions: string[] = [];
    const details: string[] = [];

    // 1. Flag key overlap
    if (
      experiment.flagKey &&
      other.flagKey &&
      experiment.flagKey === other.flagKey
    ) {
      dimensions.push("flag_key");
      details.push(
        `Both experiments use the same feature flag: "${experiment.flagKey}". ` +
          `Concurrent flag changes will interfere with each other's traffic allocation.`
      );
    }

    // 2. Metric interference — check if primary metrics overlap
    const thisMetric = experiment.primaryMetric?.split("—")[0]?.trim();
    const otherMetric = other.primaryMetric?.split("—")[0]?.trim();
    if (thisMetric && otherMetric && thisMetric === otherMetric) {
      dimensions.push("metric");
      details.push(
        `Both experiments measure "${thisMetric}" as primary metric. ` +
          `Simultaneous treatments may confound attribution — ` +
          `a lift observed in one experiment could be caused by the other.`
      );
    }

    // 3. Audience overlap — compare constraints text for audience signals
    if (experiment.constraints && other.constraints) {
      const thisAudience = extractAudienceSignals(experiment.constraints);
      const otherAudience = extractAudienceSignals(other.constraints);
      const overlap = thisAudience.filter((s) => otherAudience.includes(s));
      if (overlap.length > 0) {
        dimensions.push("audience");
        details.push(
          `Audience overlap detected on: ${overlap.join(", ")}. ` +
            `Users may be enrolled in both experiments simultaneously.`
        );
      }
    }

    // 4. Check experiment run traffic overlap on same flag
    if (dimensions.includes("flag_key")) {
      const thisRuns = experiment.experimentRuns.filter(
        (r) => r.status !== "decided"
      );
      const otherRuns = other.experimentRuns;
      if (thisRuns.length > 0 && otherRuns.length > 0) {
        // Check for time window overlap
        for (const tr of thisRuns) {
          for (const or2 of otherRuns) {
            if (tr.observationStart && or2.observationStart) {
              const trEnd = tr.observationEnd ?? new Date("2099-12-31");
              const orEnd = or2.observationEnd ?? new Date("2099-12-31");
              if (tr.observationStart <= orEnd && or2.observationStart <= trEnd) {
                details.push(
                  `Observation windows overlap: ` +
                    `"${tr.slug}" (${fmt(tr.observationStart)}–${fmt(trEnd)}) vs ` +
                    `"${or2.slug}" (${fmt(or2.observationStart)}–${fmt(orEnd)}).`
                );
              }
            }
          }
        }
      }
    }

    if (dimensions.length > 0) {
      const severity =
        dimensions.includes("flag_key") && dimensions.includes("metric")
          ? "high"
          : dimensions.includes("flag_key") || dimensions.includes("metric")
            ? "medium"
            : "low";

      conflicts.push({
        experimentId: other.id,
        experimentName: other.name,
        stage: other.stage,
        dimensions,
        details,
        severity,
      });
    }
  }

  return NextResponse.json({
    experimentId: id,
    scannedCount: others.length,
    conflicts,
    hasConflicts: conflicts.length > 0,
  });
}

/* ── helpers ── */

function extractAudienceSignals(constraints: string): string[] {
  const signals: string[] = [];
  const lower = constraints.toLowerCase();
  if (lower.includes("new user") || lower.includes("accounts created") || lower.includes("< 30 day"))
    signals.push("new_users");
  if (lower.includes("all user")) signals.push("all_users");
  if (lower.includes("pricing") || lower.includes("plan")) signals.push("pricing_users");
  if (lower.includes("free tier") || lower.includes("free plan")) signals.push("free_tier");
  if (lower.includes("enterprise")) signals.push("enterprise");
  return signals;
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}
