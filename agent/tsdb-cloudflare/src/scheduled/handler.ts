/**
 * Cron Trigger handler — runs every 3 hours.
 *
 * For each running experiment:
 *   1. Compact raw segments into daily rollups (idempotent, skips today)
 *   2. Trigger analysis via the web API (collects from TSDB → Bayesian → saves)
 *
 * Also serves as keep-alive to avoid cold-start latency on the next user query.
 */

import type { Env } from "../env";
import { compact } from "../rollup/compact";

interface RunningRun {
  id: string;
  experimentId: string;
  primaryMetricEvent: string | null;
  guardrailEvents: string | null;
  observationStart: string | null;
  experiment: {
    id: string;
    flagKey: string | null;
    envSecret: string | null;
  };
}

export async function handleScheduled(env: Env): Promise<void> {
  const apiUrl = env.WEB_API_URL;
  if (!apiUrl) {
    console.log("[cron] WEB_API_URL not configured, skipping");
    return;
  }

  // ── 1. Fetch running experiment runs from the web API ──────────────────────
  const res = await fetch(`${apiUrl}/api/experiments/running`);
  if (!res.ok) {
    console.error(`[cron] Failed to fetch running experiments: ${res.status}`);
    return;
  }

  const runs: RunningRun[] = await res.json();
  console.log(`[cron] Found ${runs.length} running experiment run(s)`);
  if (runs.length === 0) return;

  const today = new Date().toISOString().slice(0, 10);

  for (const run of runs) {
    const envId = run.experiment.envSecret;
    const flagKey = run.experiment.flagKey;

    if (!envId || !flagKey || !run.primaryMetricEvent) {
      console.log(`[cron] Skipping run ${run.id}: missing envSecret/flagKey/primaryMetricEvent`);
      continue;
    }

    // Collect all metric event names (primary + guardrails)
    const metricEvents = [run.primaryMetricEvent];
    if (run.guardrailEvents) {
      try {
        const parsed = JSON.parse(run.guardrailEvents);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            const name = typeof item === "string" ? item : item?.event;
            if (name && !metricEvents.includes(name)) metricEvents.push(name);
          }
        }
      } catch { /* ignore malformed JSON */ }
    }

    // ── 2. Compact ─────────────────────────────────────────────────────────────
    const startDate = run.observationStart
      ? run.observationStart.slice(0, 10)
      : new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

    try {
      const cr = await compact(env.TSDB_BUCKET, {
        envId,
        flagKey,
        metricEvents,
        startDate,
        endDate: today,
        force: false,
      });
      console.log(
        `[cron] Compact ${flagKey}: fe=${cr.flagEval.created}new/${cr.flagEval.skipped}skip, ` +
          `me=${cr.metricEvent.created}new/${cr.metricEvent.skipped}skip (${cr.durationMs}ms)`,
      );
    } catch (err) {
      console.error(`[cron] Compact failed for run ${run.id}:`, err);
    }

    // ── 3. Trigger analysis via web API ────────────────────────────────────────
    try {
      const analyzeRes = await fetch(
        `${apiUrl}/api/experiments/${run.experimentId}/analyze`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runId: run.id }),
        },
      );
      if (!analyzeRes.ok) {
        const errText = await analyzeRes.text();
        console.error(`[cron] Analyze failed for run ${run.id}: ${analyzeRes.status} ${errText}`);
      } else {
        console.log(`[cron] Analyzed run ${run.id} (${flagKey})`);
      }
    } catch (err) {
      console.error(`[cron] Analyze request failed for run ${run.id}:`, err);
    }
  }

  console.log("[cron] Scheduled job complete");
}
