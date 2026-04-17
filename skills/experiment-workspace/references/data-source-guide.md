# Data Source Guide

How to produce `inputData` for the experiment analysis.

The analysis script needs two numbers per variant per metric — `n` (unique users exposed) and `k` (unique users who converted). How you obtain those numbers depends on your infrastructure. This guide covers three patterns.

---

## Input Contract

`inputData` is stored as a JSON string in the experiment's database record:

```json
{
  "metrics": {
    "click_start_chat": {
      "false": {"n": 1234, "k": 89},
      "true":  {"n": 1198, "k": 112}
    },
    "error_rate": {
      "false": {"n": 1234, "k": 12},
      "true":  {"n": 1198, "k": 19}
    }
  }
}
```

Keys:
- Outer keys are metric event names — must match `primaryMetricEvent` and `guardrailEvents` in the experiment record
- Inner keys are variant values — must match `controlVariant` and `treatmentVariant` in the experiment record
- `n` = unique users exposed to that variant in the observation window
- `k` = unique users who fired the metric event at least once, out of those `n`

---

## How `inputData` Is Produced

The web app's `POST /api/experiments/:id/analyze` endpoint builds `inputData` from `track-service`: it reads the run's `featbitEnvId` + `flagKey` + `primaryMetricEvent` + guardrail events, queries ClickHouse via track-service for per-variant counts, assembles `inputData` in the canonical shape, then immediately runs the analysis and writes `analysisResult` back. One round trip, no manual step.

Your only job is to make sure instrumentation is sending events to `track-service` with the right `env_id` / `flag_key` / event names. Once events land, `/analyze` handles the rest.

---

## §FeatBit — Experiment Results API

If your FeatBit instance has an experiment results endpoint, it already computes `(n, k)` server-side. No raw exports needed.

```typescript
const FEATBIT_API_BASE  = process.env.FEATBIT_API_BASE!;   // e.g. https://your-featbit.example.com
const FEATBIT_API_TOKEN = process.env.FEATBIT_API_TOKEN!;
const ENV_ID            = process.env.FEATBIT_ENV_ID!;

async function fetchMetricSummary(
  flagKey: string, variant: string, metric: string, start: string, end: string
): Promise<[number, number]> {
  const url = new URL(`${FEATBIT_API_BASE}/api/v1/envs/${ENV_ID}/experiments/results`);
  url.searchParams.set('flagKey', flagKey);
  url.searchParams.set('metric', metric);
  url.searchParams.set('variant', variant);
  url.searchParams.set('from', start);
  url.searchParams.set('to', end);

  const resp = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${FEATBIT_API_TOKEN}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) throw new Error(`FeatBit API ${resp.status}: ${await resp.text()}`);
  const body = await resp.json();
  return [body.exposed, body.converted];
}
```

Consult your FeatBit instance's REST API docs for the exact endpoint and response field names — they may vary by version.

---

## §Database — SQL Aggregation

If your application logs flag evaluations and analytics events to its own database, a single aggregating query can return `(n, k)` directly without exporting raw rows.

```typescript
import postgres from 'postgres';  // or your preferred SQL client

const sql = postgres(process.env.DATABASE_URL!);

async function fetchMetricSummary(
  flagKey: string, variant: string, metric: string, start: string, end: string
): Promise<[number, number]> {
  const endClause = end === 'open' ? sql`` : sql`AND ev.fired_at < ${end}`;
  const endClause2 = end === 'open' ? sql`` : sql`AND e.evaluated_at < ${end}`;

  const [row] = await sql`
    SELECT
      COUNT(DISTINCT e.user_key)                                       AS n,
      COUNT(DISTINCT CASE WHEN ev.user_key IS NOT NULL
                          THEN e.user_key END)                         AS k
    FROM flag_evaluations e
    LEFT JOIN analytics_events ev
           ON ev.user_key   = e.user_key
          AND ev.event_name = ${metric}
          AND ev.fired_at  >= ${start}
          ${endClause}
    WHERE e.flag_key     = ${flagKey}
      AND e.variant      = ${variant}
      AND e.evaluated_at >= ${start}
      ${endClause2}
  `;
  return [Number(row.n), Number(row.k)];
}
```

Adapt `flag_evaluations` and `analytics_events` to your actual table and column names.

---

## §Custom — Your Own Metrics Service

If your team has an internal metrics API that already tracks funnel data, call it directly.

```typescript
const METRICS_API_BASE  = process.env.METRICS_API_BASE!;
const METRICS_API_TOKEN = process.env.METRICS_API_TOKEN!;

async function fetchMetricSummary(
  flagKey: string, variant: string, metric: string, start: string, end: string
): Promise<[number, number]> {
  const resp = await fetch(`${METRICS_API_BASE}/v1/experiment-summary`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${METRICS_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      experiment_id: flagKey,
      group: variant,
      event: metric,
      period: { from: start, to: end },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) throw new Error(`Metrics API ${resp.status}: ${await resp.text()}`);
  const body = await resp.json();
  return [body.unique_users, body.unique_converters];
}
```

Replace the endpoint, headers, and response field names with your service's actual API contract.

---

## Verifying Your Input

Trigger analysis via the web app:

```bash
npx tsx skills/experiment-workspace/scripts/analyze.ts <experiment-id> <run-id>
```

Then sanity-check the `inputData` the endpoint wrote back to the run record:

- Both variant keys match `controlVariant` and `treatmentVariant` in the experiment record
- `n` values are plausible — not 0, not absurdly high
- `k` ≤ `n` for every row
- All metrics listed in `primaryMetricEvent` and `guardrailEvents` are present

If the response is `{ "status": "no_data" }`, events haven't landed in track-service yet. See `analysis-bayesian.md` for output format and interpretation.

