/**
 * Idempotently ensure the run-active-test experiment + experiment_run exist
 * in PostgreSQL with the fixed IDs from config.ts.
 *
 * First run — INSERT the records.
 * Subsequent runs — DO NOTHING (preserves any manual edits). Only status is
 * forced back to 'running' so stats-service always picks up the canary.
 */

import pg from "pg";
import {
  EXPERIMENT_ID,
  EXPERIMENT_RUN_ID,
  EXPERIMENT_RUN_SLUG,
  ENV_ID,
  FLAG_KEY,
  GUARDRAIL_EVENTS,
  EXPERIMENT_CONTENT,
} from "./config.ts";

const { Client } = pg;

const DATABASE_URL = process.env.DATABASE_URL ?? "";
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

async function main(): Promise<void> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  try {
    // ── 1. INSERT experiment (if missing) ─────────────────────────────────────
    const expRes = await client.query(
      `
      INSERT INTO experiment (
        id, name, description, intent, hypothesis, goal, change, constraints,
        stage, featbit_env_id, flag_key,
        primary_metric, guardrails, variants,
        created_at, updated_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,
        $9,$10,$11,
        $12,$13,$14,
        NOW(), NOW()
      )
      ON CONFLICT (id) DO NOTHING
      `,
      [
        EXPERIMENT_ID,
        EXPERIMENT_CONTENT.name,
        EXPERIMENT_CONTENT.description,
        EXPERIMENT_CONTENT.intent,
        EXPERIMENT_CONTENT.hypothesis,
        EXPERIMENT_CONTENT.goal,
        EXPERIMENT_CONTENT.change,
        EXPERIMENT_CONTENT.constraints,
        EXPERIMENT_CONTENT.stage,
        ENV_ID,
        FLAG_KEY,
        EXPERIMENT_CONTENT.primaryMetric,
        EXPERIMENT_CONTENT.guardrails,
        EXPERIMENT_CONTENT.variants,
      ],
    );

    // ── 1b. Backfill NULL content fields on existing row (additive, safe) ─────
    // Only updates fields that are currently NULL → preserves any manual edits.
    await client.query(
      `
      UPDATE experiment SET
        primary_metric = COALESCE(primary_metric, $2),
        guardrails     = COALESCE(guardrails,     $3),
        variants       = COALESCE(variants,       $4),
        intent         = COALESCE(intent,         $5),
        hypothesis     = COALESCE(hypothesis,     $6),
        goal           = COALESCE(goal,           $7),
        change         = COALESCE(change,         $8),
        constraints    = COALESCE(constraints,    $9),
        featbit_env_id = COALESCE(featbit_env_id, $10),
        flag_key       = COALESCE(flag_key,       $11),
        updated_at     = NOW()
      WHERE id = $1
      `,
      [
        EXPERIMENT_ID,
        EXPERIMENT_CONTENT.primaryMetric,
        EXPERIMENT_CONTENT.guardrails,
        EXPERIMENT_CONTENT.variants,
        EXPERIMENT_CONTENT.intent,
        EXPERIMENT_CONTENT.hypothesis,
        EXPERIMENT_CONTENT.goal,
        EXPERIMENT_CONTENT.change,
        EXPERIMENT_CONTENT.constraints,
        ENV_ID,
        FLAG_KEY,
      ],
    );

    // ── 1c. Force invalid/legacy stage values onto a valid stage ──────────────
    // (Earlier versions of this script used stage='running' which isn't in the
    // web UI's STAGES list — reset anything not in the valid set to 'measuring'.)
    await client.query(
      `
      UPDATE experiment
      SET stage = $2, updated_at = NOW()
      WHERE id = $1
        AND stage NOT IN ('hypothesis','implementing','measuring','learning')
      `,
      [EXPERIMENT_ID, EXPERIMENT_CONTENT.stage],
    );

    // ── 2. INSERT experiment_run (if missing) ─────────────────────────────────
    const r = EXPERIMENT_CONTENT.run;
    const runRes = await client.query(
      `
      INSERT INTO experiment_run (
        id, experiment_id, slug, status, method, method_reason,
        primary_metric_event, primary_metric_agg, primary_metric_type,
        metric_description, guardrail_events, guardrail_descriptions,
        control_variant, treatment_variant, traffic_allocation, traffic_percent,
        minimum_sample, observation_start,
        prior_proper, prior_mean, prior_stddev,
        created_at, updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9,
        $10, $11, $12,
        $13, $14, $15, $16,
        $17, NOW(),
        $18, $19, $20,
        NOW(), NOW()
      )
      ON CONFLICT (id) DO NOTHING
      `,
      [
        EXPERIMENT_RUN_ID,
        EXPERIMENT_ID,
        EXPERIMENT_RUN_SLUG,
        r.status,
        r.method,
        r.methodReason,
        r.primaryMetricEvent,
        r.primaryMetricAgg,
        r.primaryMetricType,
        r.metricDescription,
        GUARDRAIL_EVENTS.join(","),
        r.guardrailDescriptions,
        r.controlVariant,
        r.treatmentVariant,
        r.trafficAllocation,
        r.trafficPercent,
        r.minimumSample,
        r.priorProper,
        r.priorMean,
        r.priorStddev,
      ],
    );

    // ── 3. Always force status back to 'running' (safety net) ─────────────────
    await client.query(
      `UPDATE experiment_run SET status = 'running', updated_at = NOW() WHERE id = $1 AND status <> 'running'`,
      [EXPERIMENT_RUN_ID],
    );

    const expCreated = (expRes.rowCount ?? 0) > 0;
    const runCreated = (runRes.rowCount ?? 0) > 0;
    console.log(
      `[setup-db] ok  experiment=${EXPERIMENT_ID} (${expCreated ? "created" : "exists"})  `
      + `run=${EXPERIMENT_RUN_ID} (${runCreated ? "created" : "exists"})  status=running`,
    );
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("[setup-db] failed:", e);
  process.exit(1);
});
