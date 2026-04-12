# FeatBit TSDB — Cloudflare Edition

Serverless time-series data store for FeatBit experiment telemetry.  
Replaces the .NET `FeatBit.DataWarehouse` + `FeatBit.TsdbServer` with **Cloudflare Workers + R2 + Durable Objects**, preserving identical API contracts so SDKs are unaware of the backend switch.

> Architecture details → [`../tsdb/CLOUDFLARE_DESIGN.md`](../tsdb/CLOUDFLARE_DESIGN.md)

---

## Cloudflare Services Used

| Service | What it does here | Binding in `wrangler.jsonc` |
|---|---|---|
| **Worker** | HTTP entry point — routes `/api/track`, `/api/query/experiment`, `/api/stats` | *(default — `main = "src/index.ts"`)* |
| **R2** | Object storage for columnar `.fbs` segment files (same binary format as .NET) | `TSDB_BUCKET` → bucket `featbit-tsdb` |
| **Durable Objects** | Per-partition write buffer — one actor per `(table, envId, flagKey, date)` | `PARTITION_WRITER` → class `PartitionWriterDO` |

Nothing else is needed — no KV, D1, Queues, or external databases.

---

## How the Services Work Together

```
SDK (flag eval / metric event)
  │
  ▼
Worker (src/index.ts)
  │  POST /api/track
  │  ① Parse Authorization header → envId
  │  ② Group records by partition key: (table, envId, flagKey, date)
  │  ③ Fan-out: one request per partition → Durable Object stub
  │
  ▼
Durable Object — PartitionWriterDO  (one instance per partition)
  │  ④ Buffer records in memory (up to 10 000)
  │  ⑤ Flush trigger: batch full OR 500 ms alarm fires (whichever first)
  │  ⑥ Encode columns → compress → write .fbs segment to R2
  │
  ▼
R2 Bucket (featbit-tsdb)
     key layout:  flag-evals/{envId}/{flagKey}/{date}/seg-00000001.fbs
                  metric-events/{envId}/{eventName}/{date}/seg-00000001.fbs
     custom metadata per object: zone maps (min/max timestamp) + bloom filters
```

```
ExperimentWorker (agent/data)
  │
  ▼
Worker (src/index.ts)
  │  POST /api/query/experiment
  │  ① R2.list() segments across date range → prune via metadata (zone maps + bloom)
  │  ② Parallel R2.get() for surviving segments (CONCURRENCY=16)
  │  ③ Build exposure map from flag-eval segments
  │  ④ Balance exposure map (Bayesian AB sampling)
  │  ⑤ Aggregate metric events joined to exposure map
  │  ⑥ Return ExperimentQueryResponse JSON
  │
  (no Durable Objects involved — read path is stateless)
```

---

## Prerequisites

| Requirement | Purpose |
|---|---|
| [Cloudflare account](https://dash.cloudflare.com/sign-up) | Hosts the Worker, R2, and Durable Objects |
| Workers Paid plan ($5/month) | Required — free tier's 10 ms CPU limit is too low for query decoding |
| Node.js ≥ 18 | Local dev tooling |
| `wrangler` CLI (included as devDependency) | Deploy & local dev |

---

## Deployment — Step by Step

### 1. Install dependencies

```bash
cd agent/tsdb-cloudflare
npm install
```

### 2. Authenticate with Cloudflare

```bash
npx wrangler login
```

Opens a browser for OAuth. Alternatively set the `CLOUDFLARE_API_TOKEN` env var.

### 3. Create the R2 bucket

```bash
npx wrangler r2 bucket create featbit-tsdb
```

The bucket name must match `bucket_name` in `wrangler.jsonc`.

### 4. Deploy

```bash
npx wrangler deploy
```

This single command:
- Bundles `src/index.ts` and all imports into a Worker
- Registers the `PartitionWriterDO` Durable Object class (handled by the `migrations` block)
- Binds the `TSDB_BUCKET` R2 bucket and `PARTITION_WRITER` DO namespace
- Publishes to your `*.workers.dev` subdomain

On success you'll see:

```
Published featbit-tsdb (x.xx sec)
  https://featbit-tsdb.<your-subdomain>.workers.dev
```

### 5. (Optional) Custom domain

```bash
npx wrangler domains attach featbit-tsdb tsdb.yourdomain.com
```

Or configure via Cloudflare dashboard → Workers → Routes.

---

## Local Development

```bash
npx wrangler dev
```

Starts a local server on `http://localhost:8787` with:
- Local R2 emulation (persisted in `.wrangler/state/`)
- Local Durable Object emulation
- Hot reload on source changes

### Type checking

```bash
npm run typecheck     # npx tsc --noEmit
```

### Run tests

```bash
npm test              # vitest run
npm run test:watch    # vitest (watch mode)
```

---

## API Endpoints

All endpoints are **identical** to the .NET TsdbServer — drop-in replacement.

### `POST /api/track`

Ingest flag evaluations and/or metric events.

| Header | Value |
|---|---|
| `Authorization` | Environment secret (used as `envId`) |
| `Content-Type` | `application/json` |

```jsonc
// Request body: TrackPayload[]
[
  {
    "user": { "keyId": "user-123", "name": "Alice" },
    "variations": [
      {
        "flagKey": "onboarding-v2",
        "variant": "treatment",
        "timestamp": 1712880000,       // unix seconds
        "experimentId": "exp-001",
        "sendToExperiment": true
      }
    ],
    "metrics": [
      {
        "eventName": "checkout-complete",
        "timestamp": 1712880060,
        "numericValue": 49.99
      }
    ]
  }
]
```

**Response:** `202 Accepted`

### `POST /api/query/experiment`

Run an experiment metric query (exposure → balance → aggregate).

```jsonc
// Request body: ExperimentQueryRequest
{
  "envId": "env-abc",
  "flagKey": "onboarding-v2",
  "eventName": "checkout-complete",
  "experimentId": "exp-001",
  "metricType": "binary",       // "binary" | "continuous"
  "metricAgg": "once",          // "once" | "sum" | "mean" | "count" | "latest"
  "variants": ["control", "treatment"],
  "startTime": "2025-04-01T00:00:00Z",
  "endTime": "2025-04-15T00:00:00Z",
  "balanceMode": "bayesian_ab"  // optional
}
```

**Response:** `ExperimentQueryResponse` JSON with per-variant stats (n, value/sum, mean, variance).

### `GET /api/stats`

Returns segment count and total storage bytes across all R2 prefixes.

---

## Configuration — `wrangler.jsonc`

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "featbit-tsdb",
  "main": "src/index.ts",
  "compatibility_date": "2026-04-01",
  "r2_buckets": [
    {
      "binding": "TSDB_BUCKET",           // Code accesses env.TSDB_BUCKET
      "bucket_name": "featbit-tsdb"       // Must match `wrangler r2 bucket create` name
    }
  ],
  "durable_objects": {
    "bindings": [
      {
        "name": "PARTITION_WRITER",        // Code accesses env.PARTITION_WRITER
        "class_name": "PartitionWriterDO"  // Exported from src/index.ts
      }
    ]
  },
  "migrations": [
    {
      "tag": "v1",
      "new_classes": ["PartitionWriterDO"]
    }
  ]
}
```

### Environment-specific overrides

For staging / production separation, use wrangler environments:

```jsonc
{
  "env": {
    "staging": {
      "name": "featbit-tsdb-staging",
      "r2_buckets": [
        { "binding": "TSDB_BUCKET", "bucket_name": "featbit-tsdb-staging" }
      ]
    },
    "production": {
      "name": "featbit-tsdb",
      "r2_buckets": [
        { "binding": "TSDB_BUCKET", "bucket_name": "featbit-tsdb" }
      ]
    }
  }
}
```

Deploy with: `npx wrangler deploy --env production`

---

## Project Structure

```
agent/tsdb-cloudflare/
├── wrangler.jsonc                     ← Cloudflare bindings (R2 + DO)
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts                       ← Worker entry + URL routing
    ├── env.ts                         ← Env interface (TSDB_BUCKET, PARTITION_WRITER)
    ├── endpoints/
    │   ├── track.ts                   ← POST /api/track → fan-out to DOs
    │   ├── query.ts                   ← POST /api/query/experiment → R2 scan
    │   └── stats.ts                   ← GET /api/stats → R2 list
    ├── durable-objects/
    │   └── partition-writer.ts        ← PartitionWriterDO (buffer → flush → R2)
    ├── query/
    │   ├── experiment-engine.ts       ← 3-step orchestrator: expose → balance → aggregate
    │   ├── flag-eval-scanner.ts       ← Build exposure map from flag-eval segments
    │   └── metric-event-scanner.ts    ← Aggregate metrics joined to exposure map
    ├── storage/
    │   ├── segment-format.ts          ← .fbs binary format constants + types
    │   ├── column-encoder.ts          ← Column encode/decode (delta, dict, bitmap, doubles)
    │   ├── segment-writer.ts          ← Encode record batch → ArrayBuffer
    │   ├── segment-reader.ts          ← Decode .fbs from R2 get()
    │   ├── bloom-filter.ts            ← FNV-1a bloom filter for segment pruning
    │   └── path-helper.ts             ← R2 key construction + date-range expansion
    ├── models/
    │   ├── flag-eval-record.ts        ← FlagEvalRecord + hash bucket computation
    │   ├── metric-event-record.ts     ← MetricEventRecord
    │   ├── dtos.ts                    ← API request/response types
    │   └── index.ts                   ← Barrel exports
    └── lib/
        ├── compression.ts             ← deflate-raw compress/decompress (native streams)
        └── hash.ts                    ← FNV-1a 32-bit + hashForBalance
```

---

## Cost Estimate

Based on Cloudflare pricing (R2 + Workers Paid plan):

| Component | 1M events/day | 10M events/day |
|---|---|---|
| R2 writes (PUT) | 100 PUTs → ~$0.01/mo | 1 000 PUTs → ~$0.005/mo |
| R2 reads (GET) | ~60K GETs → ~$0.02/mo | ~200K GETs → ~$0.07/mo |
| R2 storage | ~50 MB/day → ~$0.02/mo | ~500 MB/day → ~$0.23/mo |
| R2 egress | **$0** (always free) | **$0** |
| Workers Paid plan | $5/mo (flat) | $5/mo (flat) |
| Worker requests | Included in paid plan | Included in paid plan |
| Durable Objects | Minimal (buffer + counter) | ~$0.01/mo |
| **Total** | **~$5.05/mo** | **~$5.31/mo** |

The $5/month Workers Paid plan is the floor. Actual per-event costs (R2 + DO) are negligible — roughly **$0.05 per million events**. The .NET version requires a VM or container (~$10–50/month minimum), so Cloudflare is cheaper at any scale under ~100M events/day.

---

## Integration with `agent/data`

The `ExperimentWorker` in `agent/data` drives the analysis loop. To point it at the Cloudflare TSDB:

```
ExperimentWorker__TsdbBaseUrl=https://featbit-tsdb.<subdomain>.workers.dev
```

The worker calls:
1. `POST /api/query/experiment` to fetch per-variant stats
2. Passes results to `analyze-bayesian.py` for Bayesian inference
3. `POST`s analysis results back to `agent/web`

No changes needed in `agent/data` code — only the URL changes.
