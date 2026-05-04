import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/server-auth/guard";

/**
 * GET /api/agent-context/[projectKey]
 *
 * Server-side context endpoint for project-agent bootstrap.
 * Returns a compact experiment snapshot:
 *   - running: all experiments with active runs (collecting / analyzing)
 *   - recent: last 3 completed experiments (decided / archived)
 *   - summary: rolling count of older ones grouped by decision
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ projectKey: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { projectKey } = await params;

  const experiments = await prisma.experiment.findMany({
    where: { featbitProjectKey: projectKey },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      stage: true,
      flagKey: true,
      lastLearning: true,
      experimentRuns: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          status: true,
          decision: true,
          decisionSummary: true,
          trafficPercent: true,
          observationStart: true,
        },
      },
    },
  });

  const running: object[] = [];
  const completed: object[] = [];

  for (const exp of experiments) {
    const latestRun = exp.experimentRuns[0];
    if (!latestRun) continue;

    if (["collecting", "analyzing", "draft"].includes(latestRun.status)) {
      running.push({
        id: exp.id,
        name: exp.name,
        flagKey: exp.flagKey,
        traffic: latestRun.trafficPercent,
        started: latestRun.observationStart
          ? latestRun.observationStart.toISOString().slice(0, 10)
          : null,
        status: latestRun.status,
      });
    } else if (["decided", "archived"].includes(latestRun.status)) {
      completed.push({
        id: exp.id,
        name: exp.name,
        decision: latestRun.decision,
        learning: exp.lastLearning?.slice(0, 120) ?? null,
      });
    }
  }

  // Last 3 completed; rolling summary for the rest.
  const recent = completed.slice(0, 3);
  const older = completed.slice(3) as { decision?: string }[];
  const rollingCounts: Record<string, number> = {};
  for (const e of older) {
    const d = e.decision ?? "UNKNOWN";
    rollingCounts[d] = (rollingCounts[d] ?? 0) + 1;
  }
  const rollingSummary =
    older.length > 0
      ? Object.entries(rollingCounts)
          .map(([d, n]) => `${n}×${d}`)
          .join(", ")
      : null;

  return NextResponse.json({ running, recent, rollingSummary, total: experiments.length });
}
