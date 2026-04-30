# FeatBit Release Decision Agent

**End-to-end experimentation system** that guides product teams from intent → hypothesis → exposure → measurement → analysis → decision → learning.

Powered by **Bayesian A/B testing**, **feature flags**, and **AI-assisted workflows**.

---

## 🏗️ Architecture

Three production services working together:

| Service | Runtime | Role | Cloud |
|---|---|---|---|
| **agent/web** | Next.js 16 (Node.js) | Dashboard UI, REST API, experiment state (Prisma ORM) | **Cloudflare Containers** |
| **agent/tsdb-cloudflare** | CloudFlare Workers | Time-series data ingestion, metric queries, R2 storage management | **CloudFlare R2 + Scheduled Jobs** |
| **agent/sandbox** | Node.js + Claude SDK | AI-powered release decision workflow automation | **Standalone or Cloud** |

### Data Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│  User Dashboard (agent/web:3000)                                         │
│  ├─ Create experiment, define hypothesis, set up metrics               │
│  ├─ View real-time analysis results                                    │
│  └─ Make release decisions: CONTINUE / PAUSE / ROLLBACK / INCONCLUSIVE │
└────────────────────────┬────────────────────────────────────────────────┘
                         │
                         ↓
┌─────────────────────────────────────────────────────────────────────────┐
│  TSDB (agent/tsdb-cloudflare) — Hosts on tsdb.featbit.ai                │
│  ├─ POST /api/track → buffer, flush to R2 PartitionWriter DO           │
│  ├─ POST /api/query/experiment → scan R2, aggregate metrics            │
│  └─ Scheduled Job (every 3h):                                          │
│      1. Compact raw segments into daily rollups (R2 optimization)      │
│      2. Fetch running experiments from web:3000/api/experiments/running│
│      3. For each: query fresh metrics → POST web:3000/api/[id]/analyze│
└────────────────────────────────────────────────────────────────────────┘
                         │
                         ↓
┌─────────────────────────────────────────────────────────────────────────┐
│  Web Analysis API (agent/web:3000/api/experiments/{id}/analyze)        │
│  ├─ Fetch fresh || cached metric summaries from TSDB                  │
│  ├─ Run Bayesian A/B or Bandit analysis (TypeScript)                  │
│  ├─ Store results in PostgreSQL (Experiment.analysisResult)           │
│  └─ Return analysis JSON (Primary metric, guardrails, verdicts)       │
└─────────────────────────────────────────────────────────────────────────┘
                         │
                         ↓
┌─────────────────────────────────────────────────────────────────────────┐
│  Agent Sandbox (agent/sandbox:3000) — Claude Code Integration         │
│  ├─ Hosts Claude Code agent via SDK                                   │
│  ├─ SSE endpoint for real-time streaming                              │
│  └─ Calls web API to manage experiment lifecycle                      │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 📊 Database

**Single PostgreSQL instance** — `release_decision` database

| Component | Manager | Purpose |
|---|---|---|
| Prisma tables (`project`, `experiment`, `experimentRun`, `activity`, `message`) | Prisma migrations | Application state, experiment metadata, experiment results, audit log, chat history |
| Raw event tables (`flag_evaluations`, `metric_events`) | `docker/init-events.sql` (legacy reference) | **Not used** — raw events stored in R2 via TSDB |

---

## 🚀 Deployment

### Prerequisites

- **Cloudflare Account** with:
  - R2 bucket: `featbit-tsdb`
  - Domain(s): `www.featbit.ai` (web), `tsdb.featbit.ai` (TSDB)
  - Environment configured in `wrangler.toml`/`wrangler.jsonc`
- **PostgreSQL** (any provider, e.g., Azure Database for PostgreSQL)
- **Node.js 20+**, `npm`, Wrangler CLI (`npm install -g wrangler`)

### Step 1: Deploy agent/web

```bash
cd agent/web

# Set secrets
npx wrangler secret put DATABASE_URL
# Paste: postgresql://user:pass@host:5432/release_decision

# Build & deploy to Cloudflare Containers
npx wrangler deploy
```

**Result**: Next.js app runs at `https://www.featbit.ai` via Containers

### Step 2: Deploy agent/tsdb-cloudflare

```bash
cd agent/tsdb-cloudflare

# Verify R2 bucket exists: featbit-tsdb
# Verify scheduled cron trigger in wrangler.jsonc: "0 */3 * * *" (every 3 hours)

# Build & deploy to Cloudflare Workers
npx wrangler deploy
```

**Result**: 
- Data ingestion: `POST https://tsdb.featbit.ai/api/track`
- Metric queries: `POST https://tsdb.featbit.ai/api/query/experiment`
- Scheduled compaction & analysis: Runs automatically every 3 hours

### Step 3 (Optional): Deploy agent/sandbox

```bash
cd agent/sandbox

# Standalone Node.js server (optional for local Claude integration)
npm install
npm run build
npm start
```

Or deploy to any cloud (AWS Lambda, Google Cloud, Azure, etc.).

---

## 🔄 Periodic Jobs

### R2 Data Compaction (Every 3 Hours)

**Location**: `agent/tsdb-cloudflare/src/scheduled/handler.ts`  
**Trigger**: Cloudflare Scheduled Event (`0 */3 * * *`)  
**Process**:
1. List all running experiment runs from `web:3000/api/experiments/running`
2. For each experiment flag key, call `compact()` on R2:
   - Scans raw segment files (`flag-evals/`, `metric-events/`)
   - Merges into daily rollups (idempotent, skips today's in-flight data)
   - Deletes obsolete raw segments
3. Logs stats: `flagEval.created` new rollups, `flagEval.skipped` existing

**Why**: Prevents R2 from accumulating millions of small segment files; keeps query performance linear.

### Experiment Analysis (Every 3 Hours)

**Location**: `agent/tsdb-cloudflare/src/scheduled/handler.ts`  
**Trigger**: Same cron job (after compaction)  
**Process**:
1. For each running experiment run:
   - Fetch fresh metrics from TSDB: `POST /api/query/experiment`
   - Call `web:3000/api/experiments/{id}/analyze` with `{ runId, forceFresh: true }`
   - Web API runs Bayesian analysis, stores results
2. Returns verdicts for primary metric + guardrails

**Why**: Continuous analysis without user intervention; experiment results always fresh.

### Manual Analysis Refresh (On-Demand)

**User-initiated**: Click "Refresh Latest Analysis" button in Full Analysis tab  
**Flow**:
- UI sends: `POST /api/experiments/{id}/analyze` with `{ runId, forceFresh: true }`
- Web API fetches fresh TSDB data (no fallback to stale DB cache)
- Returns latest verdict or clear error: "Failed to fetch fresh data from TSDB"

---

## 📁 Project Structure

```
featbit-release-decision-agent/
├─ README.md                           ← You are here
├─ AGENTS.md                           ← Service details, environment vars
├─ docker-compose.yml                  ← Legacy: Used for local E2E testing only
│
├─ agent/web/
│  ├─ src/
│  │  ├─ app/
│  │  │  ├─ (dashboard)/              ← Dashboard pages
│  │  │  ├─ (project)/                ← Project/experiment pages
│  │  │  └─ api/
│  │  │     ├─ experiments/            ← Experiment CRUD
│  │  │     ├─ experiments/[id]/analyze/route.ts ← Analysis engine
│  │  │     └─ experiments/running/    ← Running experiments (used by cron)
│  │  ├─ lib/
│  │  │  ├─ stats/
│  │  │  │  ├─ analyze.ts             ← Bayesian A/B orchestrator
│  │  │  │  ├─ bandit.ts              ← Multi-armed bandit analysis
│  │  │  │  ├─ bayesian.ts            ← Bayesian math (Beta-Binomial, Normal)
│  │  │  │  └─ tsdb-client.ts         ← TSDB query client
│  │  │  ├─ prisma.ts                 ← Database client
│  │  │  └─ data.ts                   ← Experiment CRUD helpers
│  │  └─ components/experiment/
│  │     ├─ experiment-run-table.tsx   ← Experiment runs table + drawer
│  │     ├─ analysis-markdown.tsx      ← Renders analysis JSON
│  │     └─ (other UI components)
│  ├─ prisma/
│  │  ├─ schema.prisma                 ← Experiment, Activity, Message models
│  │  └─ migrations/                   ← Applied schema changes
│  ├─ Dockerfile                       ← Next.js container image
│  ├─ wrangler.jsonc                   ← Cloudflare Containers config
│  └─ package.json
│
├─ agent/tsdb-cloudflare/
│  ├─ src/
│  │  ├─ index.ts                      ← Worker entry, route handlers
│  │  ├─ env.ts                        ← Env interface (TSDB_BUCKET, WEB_API_URL)
│  │  ├─ endpoints/
│  │  │  ├─ track.ts                   ← POST /api/track — ingest events
│  │  │  ├─ query.ts                   ← POST /api/query/experiment — fetch metrics
│  │  │  ├─ stats.ts                   ← GET /api/stats — R2 usage
│  │  │  └─ compact.ts                 ← (internal, called by scheduled handler)
│  │  ├─ scheduled/
│  │  │  └─ handler.ts                 ← Cron job: compact + analyze
│  │  ├─ durable-objects/
│  │  │  └─ partition-writer.ts        ← PartitionWriterDO: buffers → R2
│  │  ├─ query/
│  │  │  ├─ experiment-engine.ts       ← Experiment query orchestrator
│  │  │  ├─ flag-eval-scanner.ts       ← Scans flag eval segments
│  │  │  └─ metric-event-scanner.ts    ← Scans metric event segments
│  │  ├─ rollup/
│  │  │  └─ compact.ts                 ← Compaction logic
│  │  └─ storage/
│  │     ├─ segment-writer.ts          ← Write compressed segments
│  │     └─ segment-reader.ts          ← Read compressed segments
│  ├─ wrangler.jsonc                   ← Cloudflare Workers config + cron
│  ├─ package.json
│  └─ tsconfig.json
│
├─ agent/sandbox/
│  ├─ src/
│  │  ├─ server.ts                     ← Express + SSE endpoint
│  │  ├─ agent.ts                      ← Claude Code agent runner
│  │  └─ prompt.ts                     ← Slash command builder
│  ├─ scripts/
│  │  └─ sync.ts                       ← Project sync CLI
│  ├─ Dockerfile
│  ├─ docker-compose.yml               ← Standalone dev environment
│  ├─ package.json
│  └─ tsconfig.json
│
├─ skills/
│  ├─ featbit-release-decision/        ← Hub skill (routes by stage)
│  ├─ intent-shaping/                  ← CF-01: clarify goal
│  ├─ hypothesis-design/               ← CF-02: craft falsifiable hypothesis
│  ├─ reversible-exposure-control/     ← CF-03/04: design flag + rollout
│  ├─ measurement-design/              ← CF-05: define primary metric + guardrails
│  ├─ experiment-workspace/            ← CF-05+: manage experiment records + run analysis
│  ├─ evidence-analysis/               ← CF-06/07: interpret results → decision
│  ├─ learning-capture/                ← CF-08: structured postmortem
│  └─ project-sync/                    ← CLI: persist state to web DB
│
└─ docker/
   └─ init-events.sql                  ← Legacy: unused (events now in R2)
```

---

## 🔧 Environment Variables & Secrets

### agent/web (Cloudflare Containers)

| Variable | Type | Required | Purpose |
|---|---|---|---|
| `DATABASE_URL` | Secret | Yes | PostgreSQL connection string |
| `SANDBOX0_API_KEY` | Secret | Yes | Server-side auth for the default sandbox0 (Managed Agents) backend |
| `SANDBOX0_BASE_URL` | Env | No | Defaults to `https://agents.sandbox0.ai` |
| `NEXT_PUBLIC_FEATBIT_API_URL` | Build arg | Yes | FeatBit backend for auth |
| `NEXT_PUBLIC_AGENT_BACKEND` | Build arg | No | `sandbox0` (default) or `classic`. Only set explicitly to override. |
| `NEXT_PUBLIC_SANDBOX_URL` | Build arg | No | Only relevant when `NEXT_PUBLIC_AGENT_BACKEND=classic` |

Example `.env` (local dev):
```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/release_decision
```

### agent/tsdb-cloudflare (Cloudflare Workers)

| Variable | Type | Required | Purpose |
|---|---|---|---|
| `TSDB_BUCKET` | R2 binding | Yes | R2 bucket for raw events & rollups |
| `WEB_API_URL` | Env var | Yes | Web API base URL for cron job (e.g., `https://www.featbit.ai`) |
| `TSDB_MAX_BATCH_SIZE` | Env var | No | Max records per PartitionWriter flush (default: 10000) |
| `TSDB_FLUSH_INTERVAL_MS` | Env var | No | Time-based flush trigger (default: 2000ms) |

Set in `wrangler.jsonc`:
```json
{
  "vars": {
    "TSDB_MAX_BATCH_SIZE": "10000",
    "TSDB_FLUSH_INTERVAL_MS": "2000"
  },
  "r2_buckets": [{
    "binding": "TSDB_BUCKET",
    "bucket_name": "featbit-tsdb"
  }]
}
```

### agent/sandbox (Node.js)

| Variable | Type | Required | Purpose |
|---|---|---|---|
| `GLM_API_KEY` | Env | Yes | Zhipuai API key (for local Claude SDK testing) |
| `SYNC_API_URL` | Env | Yes | Web API base URL (for skill operations) |

---

## 🧪 Local Development

For quick local testing (docker-compose):

```bash
# Start PostgreSQL + web + sandbox
docker-compose up --build

# Open UI: http://localhost:3000
# Open Sandbox SSE: http://localhost:3100
```

**Note**: This spins up old services (`tsdb`, `data`, `simulator`). They are **not used** in production; ignore their logs.

---

## 📖 API Reference

### Running Experiments

```bash
# Fetch all running experiments (used by cron job)
GET /api/experiments/running
```

### Analyze Experiment

```bash
POST /api/experiments/{id}/analyze
{
  "runId": "exp-run-123",
  "forceFresh": true  # If true, fail rather than return stale data
}
```

Returns:
```json
{
  "inputData": "{\"metrics\": {...}}",
  "analysisResult": "{\"type\": \"bayesian\", \"primary_metric\": {...}, ...}",
  "stale": false,
  "warning": null
}
```

---

## 📚 Further Reading

- **[AGENTS.md](AGENTS.md)** — Detailed service configuration and troubleshooting
- **[skills/featbit-release-decision/SKILL.md](skills/featbit-release-decision/SKILL.md)** — Release decision workflow phases (CF-01 through CF-08)

---

## ⚙️ Troubleshooting

### TSDB `/api/query` returns no data
- Check R2 bucket exists and has segments
- Verify `WEB_API_URL` is accessible from TSDB Worker
- Check Cloudflare logs for network errors

### Analysis results not updating
- Verify cron job runs: check Cloudflare Workers Analytics
- Confirm `WEB_API_URL` environment variable is set correctly
- Check web logs for `/api/experiments/running` and `/api/experiments/{id}/analyze` hits

### UI shows "stale" analysis
- Click "Refresh Latest Analysis" button for manual refresh
- Or wait up to 3 hours for next automatic cron run

---

**Version**: April 2026  
**License**: TBD
