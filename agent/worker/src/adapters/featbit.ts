import pg from "pg";
import type {
  FetchMetricSummary,
  FetchParams,
  MetricSummary,
  MetricAgg,
  BinaryVariant,
  ContinuousVariant,
} from "./interface.js";

/**
 * featbitFetch — queries FeatBit's PostgreSQL event tables directly.
 *
 * Requires env var FEATBIT_PG_URL pointing to FeatBit's database, e.g.:
 *   postgresql://user:pass@host:5432/featbit
 *
 * Tables read:
 *   flag_evaluations  — exposure data (with experiment_id stain)
 *   metric_events     — user behavior events
 *
 * Routing:
 *   metricType === "binary"  → counts unique converted users → { n, k }
 *   metricType !== "binary"  → aggregates numeric_value per user → { n, mean, variance, total }
 */
export const featbitFetch: FetchMetricSummary = async (
  params: FetchParams
): Promise<MetricSummary> => {
  const connectionString = process.env.FEATBIT_PG_URL;
  if (!connectionString) {
    throw new Error("FEATBIT_PG_URL env var is required for the FeatBit adapter");
  }

  const client = new pg.Client({ connectionString });
  await client.connect();

  try {
    if (params.metricType === "binary") {
      return await queryBinary(client, params);
    } else {
      return await queryContinuous(client, params);
    }
  } finally {
    await client.end();
  }
};

// ── Binary metric: { n, k } per variant ────────────────────────────────────────

async function queryBinary(
  client: pg.Client,
  params: FetchParams
): Promise<MetricSummary> {
  const { envId, flagKey, experimentId, metricEvent, start, end } = params;

  const sql = `
    WITH first_exposure AS (
      SELECT DISTINCT ON (user_key)
        user_key, variant, evaluated_at AS first_exposed_at
      FROM flag_evaluations
      WHERE env_id = $1
        AND flag_key = $2
        AND experiment_id = $3
        AND evaluated_at BETWEEN $4 AND $5
      ORDER BY user_key, evaluated_at ASC
    ),
    exposed AS (
      SELECT variant, COUNT(*) AS n
      FROM first_exposure
      GROUP BY variant
    ),
    converted AS (
      SELECT fe.variant, COUNT(DISTINCT fe.user_key) AS k
      FROM first_exposure fe
      JOIN metric_events me
        ON  me.user_key      = fe.user_key
        AND me.env_id        = $1
        AND me.event_name    = $6
        AND me.occurred_at  >= fe.first_exposed_at
        AND me.occurred_at  BETWEEN $4 AND $5
      GROUP BY fe.variant
    )
    SELECT e.variant, e.n, COALESCE(c.k, 0) AS k
    FROM exposed e
    LEFT JOIN converted c USING (variant)
  `;

  const result = await client.query(sql, [envId, flagKey, experimentId, start, end, metricEvent]);

  const byVariant = new Map(result.rows.map((r) => [r.variant, r]));
  const control = byVariant.get(params.controlVariant);
  const treatment = byVariant.get(params.treatmentVariant);

  return {
    metricType: "binary",
    control:   { n: Number(control?.n ?? 0),   k: Number(control?.k ?? 0) }   as BinaryVariant,
    treatment: { n: Number(treatment?.n ?? 0), k: Number(treatment?.k ?? 0) } as BinaryVariant,
  };
}

// ── Continuous metric: { n, mean, variance, total } per variant ────────────────

/** Maps MetricAgg to the SQL aggregation applied per-user on numeric_value. */
function aggFunction(agg: MetricAgg): string {
  switch (agg) {
    case "sum":     return "SUM(me.numeric_value)";
    case "mean":    return "AVG(me.numeric_value)";
    case "count":   return "COUNT(me.numeric_value)";
    case "latest":  return "(ARRAY_AGG(me.numeric_value ORDER BY me.occurred_at DESC))[1]";
    case "once":    return "(ARRAY_AGG(me.numeric_value ORDER BY me.occurred_at ASC))[1]";
    default:        return "SUM(me.numeric_value)";
  }
}

async function queryContinuous(
  client: pg.Client,
  params: FetchParams
): Promise<MetricSummary> {
  const { envId, flagKey, experimentId, metricEvent, metricAgg, start, end } = params;

  const aggExpr = aggFunction(metricAgg);

  const sql = `
    WITH first_exposure AS (
      SELECT DISTINCT ON (user_key)
        user_key, variant, evaluated_at AS first_exposed_at
      FROM flag_evaluations
      WHERE env_id = $1
        AND flag_key = $2
        AND experiment_id = $3
        AND evaluated_at BETWEEN $4 AND $5
      ORDER BY user_key, evaluated_at ASC
    ),
    per_user AS (
      SELECT
        fe.variant,
        fe.user_key,
        ${aggExpr} AS user_value
      FROM first_exposure fe
      JOIN metric_events me
        ON  me.user_key      = fe.user_key
        AND me.env_id        = $1
        AND me.event_name    = $6
        AND me.occurred_at  >= fe.first_exposed_at
        AND me.occurred_at  BETWEEN $4 AND $5
      WHERE me.numeric_value IS NOT NULL
      GROUP BY fe.variant, fe.user_key
    )
    SELECT
      variant,
      COUNT(*)              AS n,
      AVG(user_value)       AS mean,
      VAR_SAMP(user_value)  AS variance,
      SUM(user_value)       AS total
    FROM per_user
    GROUP BY variant
  `;

  const result = await client.query(sql, [envId, flagKey, experimentId, start, end, metricEvent]);

  const byVariant = new Map(result.rows.map((r) => [r.variant, r]));
  const control = byVariant.get(params.controlVariant);
  const treatment = byVariant.get(params.treatmentVariant);

  const toVariant = (row: Record<string, unknown> | undefined): ContinuousVariant => ({
    n:        Number(row?.n ?? 0),
    mean:     Number(row?.mean ?? 0),
    variance: Number(row?.variance ?? 0),
    total:    Number(row?.total ?? 0),
  });

  return {
    metricType: params.metricType,
    control:   toVariant(control),
    treatment: toVariant(treatment),
  };
}
