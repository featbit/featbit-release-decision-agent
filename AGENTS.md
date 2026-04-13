# AGENTS.md — FeatBit Release Decision Services

> Deployment and operation guide for three production services.

---

## 🏗️ Three-Service Architecture

```
┌─────────────────────┐
│   agent/web         │  Next.js + Prisma
│   Cloudflare        │  Dashboard + REST API
│   Containers        │  Analysis compute
└──────────┬──────────┘
           ↑ queries/results
           ↓
┌─────────────────────────────────────────┐           ┌──────────────────┐
│  agent/tsdb-cloudflare                  │           │   agent/sandbox  │
│  Cloudflare Workers                     │←────────→ │  Claude SDK      │
│  - /api/track (ingest)                  │           │  Node.js SSE     │
│  - /api/query (metrics)                 │           │  Worker          │
│  - /api/stats (R2 info)                 │           │  [Optional]      │
│  - Cron: compact + analyze (every 3h)   │           └──────────────────┘
│  - R2 storage (segments + rollups)      │
└─────────────────────────────────────────┘
```

---

## 1️⃣ agent/web — Next.js Dashboard & API

**Language**: TypeScript (Next.js 16)  
**Platform**: Cloudflare Containers  
**Port** (local): 3000  
**URL** (production): `https://www.featbit.ai`

### Responsibilities

- **UI**: Experiment dashboard, workflow wizard (CF-01 through CF-08)
- **REST API**: Experiment CRUD, project state, activity log
- **Analysis Engine**: Bayesian A/B, Bandit analysis (in-process TypeScript)
- **Database**: PostgreSQL (Prisma ORM)

### Key Files

```
src/
├─ app/
│  ├─ (dashboard)/experiments/          ← Experiments list
│  ├─ (project)/experiments/[id]/       ← Experiment detail + workflow stages
│  └─ api/
│     ├─ experiments/[id]/analyze/route.ts   ← Analysis orchestrator
│     ├─ experiments/[id]/state/route.ts     ← Experiment state CRUD
│     ├─ experiments/running/route.ts        ← Running experiments list (for cron)
│     └─ (other CRUD endpoints)
├─ lib/
│  ├─ stats/
│  │  ├─ analyze.ts          ← Bayesian A/B orchestrator
│  │  ├─ bandit.ts           ← Thompson sampling
│  │  ├─ bayesian.ts         ← Bayesian math (Beta-Binomial, Normal)
│  │  ├─ tsdb-client.ts      ← TSDB HTTP client (metrics collection)
│  │  └─ types.ts            ← Metric types
│  ├─ prisma.ts              ← Prisma client singleton
│  ├─ data.ts                ← Experiment queries + mutations
│  └─ actions.ts             ← Server actions (revalidatePath calls)
└─ components/experiment/     ← UI components
   ├─ experiment-run-table.tsx   ← Experiment runs + analysis drawer
   ├─ analysis-markdown.tsx      ← Renders analysis JSON
   └─ (stage-specific components)
```

### Database Schema (Prisma)

**Core entities**:
- `Project` — top-level container (stage, goal, hypothesis, etc.)
- `Experiment` — parent of runs (flags, metrics definition)
- `ExperimentRun` — individual A/B test instance (variants, observation window, results)
- `Activity` — append-only audit log per project
- `Message` — chat history per project

### Analysis Orchestration

**Flow** (`POST /api/experiments/{id}/analyze`):
1. Accept `runId` + optional `forceFresh`
2. Fetch metrics from TSDB: `collectMetric()` or `collectManyMetrics()`
   - `metricEvent`: primary metric
   - `guardrailEvents`: array of guardrail metric names
3. Run `runAnalysis()` or `runBanditAnalysis()` in-process
   - Computes Bayesian posterior, credible intervals, P(win), verdicts
4. Store `inputData` + `analysisResult` in `ExperimentRun`
5. Return JSON (can have `stale: true` if TSDB unavailable + DB fallback exists)

**If `forceFresh=true`**: Reject with 503 if TSDB unavailable (no fallback to stale DB result).

### Environment Variables

| Variable | Type | Required | Example |
|---|---|---|---|
| `DATABASE_URL` | Secret | Yes | `postgresql://user:pass@host:5432/release_decision` |
| `NEXT_PUBLIC_SANDBOX_URL` | Build arg | No | `http://localhost:3100` |
| `TSDB_BASE_URL` | Code default | No | Defaults to `https://tsdb.featbit.ai` |

### Deployment (Cloudflare Containers)

```bash
cd agent/web

# Set PostgreSQL connection secret
npx wrangler secret put DATABASE_URL

# Deploy
npx wrangler deploy
```

**Result**: Custom domain `https://www.featbit.ai` routes through Cloudflare to Next.js container.

### Caching

- No HTTP caching on `/api/experiments/{id}/analyze`
- Page-level revalidation via `revalidatePath()` after state changes
- Prisma client configured for PostgreSQL connection pooling

---

## 2️⃣ agent/tsdb-cloudflare — Time-Series Data & Cron

**Language**: TypeScript  
**Platform**: Cloudflare Workers + R2  
**URL** (production): `https://tsdb.featbit.ai`

### Responsibilities

- **Data Ingestion**: `POST /api/track` → buffers → PartitionWriter DO → R2
- **Metric Queries**: `POST /api/query/experiment` → scans R2 segments → aggregate statistics
- **Storage Optimization**: Cron job (every 3h) compacts raw segments into daily rollups
- **Experiment Analysis**: Cron job (every 3h) fetches running experiments, triggers analysis

### Architecture

**Event Flow**:
```
POST /api/track (event payload)
  ↓
Worker (track.ts)
  ├─ Group by partition: (table, envId, key, date)
  └─ Dispatch to PartitionWriter DO
       ↓
PartitionWriter DO (durable-objects/partition-writer.ts)
  ├─ Buffer records in memory
  ├─ Flush on: size threshold OR time threshold
  └─ Write compressed segment to R2
       ↓
R2 Bucket: featbit-tsdb/
  ├─ flag-evals/{envId}/{flagKey}/{date}/seg-00000001.bin
  ├─ flag-evals/{envId}/{flagKey}/{date}/seg-00000002.bin
  ├─ metric-events/{envId}/{eventName}/{date}/seg-*.bin
  └─ (daily) rollups/flag-evals/{envId}/{flagKey}/{date}.bin
```

**Query Flow**:
```
POST /api/query/experiment
  ↓
Worker (query.ts)
  └─ Call queryExperiment(bucket, query)
       ↓
ExperimentEngine (query/experiment-engine.ts)
  ├─ Step 1: Build exposure map
  │    └─ flagEvalScanner: read flag-evals → filter by time/experiment_id/layer_id/audience
  ├─ Step 2: Balance variants (bayesian_ab only)
  ├─ Step 3: Aggregate metrics
  │    └─ metricEventScanner: read metric-events → join on exposure map
  └─ Return: VariantStats[] (n, k/mean, variance)
       ↓
Response JSON (Cache-Control: no-store)
  {
    "metricType": "binary" | "continuous",
    "variants": {
      "control": { "n": 2318, "k": 0 },
      "treatment": { "n": 2318, "k": 0 }
    }
  }
```

### Cron Job Details

**Schedule**: `0 */3 * * *` (every 3 hours)  
**Location**: `src/scheduled/handler.ts`

**Step 1: Compact R2**
```
For each running experiment run (fetched from web:3000/api/experiments/running):
  1. Call compact(bucket, { envId, flagKey, metricEvents, startDate, endDate, force })
  2. Idempotent: skips today (in-flight data)
  3. Merges raw segments → daily rollups
  4. Logs: e.g., "fe=3new/5skip, me=4new/2skip (1234ms)"
```

**Step 2: Analyze**
```
For each running experiment run:
  1. Fetch fresh metrics: POST /api/query/experiment with metric events
  2. Call web:3000/api/experiments/{id}/analyze with { runId, forceFresh: true }
  3. Store result in Experiment.analysisResult
  4. Logs: "Analyzed run {id} ({flagKey})"
```

### Key Files

```
src/
├─ index.ts                    ← Worker entry, route handlers
├─ env.ts                      ← Env interface
├─ endpoints/
│  ├─ track.ts                 ← POST /api/track
│  ├─ query.ts                 ← POST /api/query/experiment (with Cache-Control headers)
│  ├─ stats.ts                 ← GET /api/stats
│  └─ compact.ts               ← [internal]
├─ scheduled/
│  └─ handler.ts               ← Cron job (handleScheduled)
├─ durable-objects/
│  └─ partition-writer.ts      ← PartitionWriterDO (buffering)
├─ query/
│  ├─ experiment-engine.ts     ← Query orchestrator
│  ├─ flag-eval-scanner.ts     ← Flag exposure aggregation
│  └─ metric-event-scanner.ts  ← Metric aggregation
├─ rollup/
│  └─ compact.ts               ← Compaction logic
└─ storage/
   ├─ segment-writer.ts        ← Compress + write
   ├─ segment-reader.ts        ← Decompress + read
   └─ segment-format.ts        ← Binary format spec
```

### Environment Variables

| Variable | Type | Required | Purpose |
|---|---|---|---|
| `TSDB_BUCKET` | R2 binding | Yes | R2 bucket name: `featbit-tsdb` |
| `WEB_API_URL` | Env var | Yes | Web service base URL: `https://www.featbit.ai` |
| `TSDB_MAX_BATCH_SIZE` | Env var | No | Max records per flush (default: 10000) |
| `TSDB_FLUSH_INTERVAL_MS` | Env var | No | Time-based flush trigger (default: 2000ms) |
| `TSDB_MIN_FLUSH_ROWS` | Env var | No | Min rows to trigger flush (default: 200) |
| `TSDB_MAX_BUFFER_AGE_MS` | Env var | No | Max age before force flush (default: 3000ms) |

### Deployment (Cloudflare Workers)

```bash
cd agent/tsdb-cloudflare

# Verify R2 bucket exists
wrangler r2 bucket list
# If not: wrangler r2 bucket create featbit-tsdb

# Deploy
npx wrangler deploy
```

**Result**: Custom domain `https://tsdb.featbit.ai` routes through Cloudflare to Worker.

### Monitoring

- **Cron logs**: Cloudflare Workers Analytics → Cron Triggers
- **Custom logging**: `console.log()` in handler visible in real-time logs
- **R2 usage**: `GET /api/stats` returns segment counts and total bytes

---

## 3️⃣ agent/sandbox — Claude Code Agent (Optional)

**Language**: TypeScript (Node.js)  
**Platform**: Standalone or Cloud  
**Port** (local): 3000  
**Type**: SSE endpoint (Server-Sent Events)

### Responsibilities

- **Agent Hosting**: Runs Claude Code agent via `@anthropic-ai/claude-agent-sdk`
- **Skill Integration**: Routes to satellite skills based on workflow stage (CF-01 through CF-08)
- **SSE Streaming**: Real-time agent thoughts and actions to client
- **Project Sync**: CLI script to persist experiment state to web DB

### Architecture

**Session Model**:
- Each project gets a stable UUID → session ID mapping
- New sessions begin with `/featbit-release-decision <projectId>` slash command
- Resumed sessions pass user prompt directly, preserving agent memory

**Skill Routing**:
- Hub skill: `skills/featbit-release-decision/SKILL.md`
- Satellite skills (in `skills/` directory):
  - `intent-shaping/SKILL.md` (CF-01)
  - `hypothesis-design/SKILL.md` (CF-02)
  - `reversible-exposure-control/SKILL.md` (CF-03/04)
  - `measurement-design/SKILL.md` (CF-05)
  - `experiment-workspace/SKILL.md` (CF-05+)
  - `evidence-analysis/SKILL.md` (CF-06/07)
  - `learning-capture/SKILL.md` (CF-08)
  - `project-sync/SKILL.md` (all stages)

### Key Files

```
src/
├─ server.ts         ← Express + SSE endpoint
├─ agent.ts          ← agent-sdk query runner
├─ prompt.ts         ← Builds effective prompt
└─ session-id.ts     ← projectId ↔ UUID mapping

scripts/
└─ sync.ts           ← Project sync CLI (invoked by project-sync skill)

data/                ← Local JSON for project state (optional)
```

### Deployment (Standalone)

```bash
cd agent/sandbox

npm install
npm run build
npm start
```

**Environment Variables**:
- `GLM_API_KEY`: Zhipuai API key (for local testing)
- `SYNC_API_URL`: Web service base URL (e.g., `http://localhost:3000`)
- `PORT`: Server port (default: 3000)

### SSE Endpoint

```
POST http://localhost:3000/query
{
  "projectId": "proj-123",
  "message": "please analyze the results"
}
```

Response: Server-Sent Events stream with agent thoughts, actions, and final response.

---

## 📡 API Contracts

### agent/web → agent/tsdb-cloudflare

**Metrics Query** (from analysis API):
```bash
POST https://tsdb.featbit.ai/api/query/experiment
Authorization: {envId}
Content-Type: application/json

{
  "envId": "pricing-env-123",
  "flagKey": "pricing-page",
  "metricEvent": "page_view",
  "metricType": "binary",
  "metricAgg": "once",
  "controlVariant": "original",
  "treatmentVariant": "redesigned",
  "start": "2026-04-01T00:00:00Z",
  "end": "2026-04-14T23:59:59Z",
  "experimentId": "exp-456",
  "method": "bayesian_ab"
}
```

**Response**:
```json
{
  "metricType": "binary",
  "variants": {
    "original": { "n": 2318, "k": 45 },
    "redesigned": { "n": 2318, "k": 61 }
  }
}
```

### agent/tsdb-cloudflare → agent/web

**Fetch Running Experiments** (from cron):
```bash
GET https://www.featbit.ai/api/experiments/running
```

**Response**:
```json
[
  {
    "id": "run-789",
    "experimentId": "exp-456",
    "primaryMetricEvent": "page_view",
    "guardrailEvents": "[\"bounce_rate\", \"timeout_errors\"]",
    "observationStart": "2026-04-01T00:00:00Z",
    "experiment": {
      "id": "exp-456",
      "flagKey": "pricing-page",
      "envSecret": "pricing-env-123"
    }
  }
]
```

**Trigger Analysis** (from cron):
```bash
POST https://www.featbit.ai/api/experiments/exp-456/analyze
Content-Type: application/json

{
  "runId": "run-789",
  "forceFresh": true
}
```

**Response**:
```json
{
  "inputData": "{\"metrics\": {...}}",
  "analysisResult": "{\"type\": \"bayesian\", \"verdict\": \"...\"}"
}
```

---

## 🔍 Troubleshooting

### TSDB `/api/query` returns empty data

**Symptoms**:
- Web API analysis fails with "No data returned from TSDB"
- Or falls back to stale DB result

**Diagnosis**:
1. Check R2 bucket exists:
   ```bash
   npm run wrangler r2 bucket list
   ```
2. Check segment files exist:
   ```bash
   npm run wrangler r2 object list --bucket=featbit-tsdb
   ```
3. Check cron job logs:
   - Cloudflare Dashboard → Workers → featbit-tsdb → Logs
   - Look for "Found N running experiment run(s)"

**Fix**:
- Verify `WEB_API_URL` is accessible from Cloudflare Workers
- Ensure firewall rules allow outbound to web API
- Check if events were actually ingested: `GET /api/stats`

### Cron job not running

**Symptoms**:
- Analysis results never update
- R2 segments accumulate without compaction

**Diagnosis**:
1. Verify trigger in `wrangler.jsonc`:
   ```json
   "triggers": {
     "crons": ["0 */3 * * *"]
   }
   ```
2. Check Cloudflare dashboard:
   - Workers → Triggers → Check cron status
3. Look at logs:
   - Workers → Tail → Filter by `handleScheduled`

**Fix**:
- Redeploy: `npx wrangler deploy`
- Verify `WEB_API_URL` environment variable is set
- Manually trigger for testing:
   ```bash
   # Not possible directly, but check logs after next cron window
   ```

### Analysis results show "stale: true"

**Symptoms**:
- UI displays old analysis with warning: "last successful analysis"
- User wants latest results

**Solution**:
- Click "Refresh Latest Analysis" button in Full Analysis tab
- Or wait up to 3 hours for next cron run

---

## 📊 Monitoring & Metrics

**Key metrics to watch**:
- **TSDB cron job success rate**: Should be 100%
- **Web API `/analyze` latency**: <5s typical
- **R2 segment size distribution**: Healthy if <100MB rollups
- **PostgreSQL connection pool**: Monitor active connections

**Logging**:
- **agent/web**: Check application logs for `/api/experiments/{id}/analyze` calls
- **agent/tsdb-cloudflare**: Cloudflare Dashboard → Logs
- **agent/sandbox**: STDOUT in container or cloud logs

---

## 🚀 Scaling Considerations

- **Concurrent experiments**: TSDB scales with R2 throughput; CPU limited by Cloudflare Workers
- **Metric cardinality**: Each unique (envId, flagKey, metricEvent) creates separate R2 partition
- **Query latency**: Inversely related to compaction frequency; every 3h is tunable
- **PostgreSQL**: Ensure connection pooling configured for concurrent web requests

---

**Last Updated**: April 2026
