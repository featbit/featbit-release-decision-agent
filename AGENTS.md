# AGENTS.md — FeatBit Release Decision Agent

> Architecture, service map, and operational guide. Day-to-day development uses
> each service's native dev loop (`npm run dev`, `dotnet run`); docker compose
> is for cross-service integration and prod-like reproductions, not the default.

---

## 🏗️ Five-Service Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  modules/web  (Next.js + Prisma)  :3000                     │
│  Dashboard + REST API + Analysis Engine + Memory API        │
└──────┬───────────────────────────┬──────────────────────────┘
       │ TRACK_SERVICE_URL          │ MEMORY_API_BASE / SYNC_API_URL
       ↓                           ↓
┌─────────────────────┐   ┌──────────────────────┐   ┌────────────────────────┐
│  modules/track-     │   │  modules/sandbox      │   │  modules/project-agent │
│  service (.NET 10)  │   │  (Claude SDK, SSE)    │   │  (Codex, SSE)          │
│  :5050 → :8080      │   │  :3100 → :3000        │   │  :3031 → :3031         │
│  POST /api/track    │   │  POST /query          │   │  POST /query           │
│  POST /api/query/   │   │  (experiment skills)  │   │  (project memory +     │
│       experiment    │   │                       │   │   onboarding)          │
│  GET  /health       │   │                       │   │                        │
└──────────┬──────────┘   └──────────────────────┘   └────────────────────────┘
           ↑
┌──────────────────────┐
│  modules/run-active- │
│  test-worker         │
│  (Cloudflare Worker) │
│  Cron: every minute  │
│  → POST /api/track   │
└──────────────────────┘

Storage:
  PostgreSQL (Azure)  ← web/Prisma
  ClickHouse          ← track-service read/write
```

All services are wired together in `modules/docker-compose.yml`.

---

## 1️⃣ modules/web — Next.js Dashboard & API

**Language**: TypeScript (Next.js 16 App Router)  
**Port** (docker): 3000  
**DB**: PostgreSQL via Prisma ORM

### Responsibilities

- **UI**: Experiment dashboard, wizard stages (intent → hypothesis → exposure → measurement → analysis → decision → learning)
- **REST API**: Experiment / run CRUD, activity log, memory, agent-session proxy
- **Analysis Engine**: Bayesian A/B + Bandit analysis (in-process TypeScript)
- **Memory API**: Per-project and per-user AI memory storage (`/api/memory/`)

### Key Files

```
modules/web/src/
├─ app/
│  ├─ (dashboard)/experiments/       ← Experiments list + data warehouse pages
│  ├─ (project)/experiments/[id]/    ← Experiment detail + workflow stages
│  └─ api/
│     ├─ experiments/[id]/analyze/   ← Analysis orchestrator (POST)
│     ├─ experiments/[id]/stage/     ← Stage transitions
│     ├─ experiments/[id]/state/     ← Full state CRUD
│     ├─ experiments/[id]/activity/  ← Activity log append
│     ├─ experiments/[id]/conflicts/ ← Conflict detection
│     ├─ experiments/[id]/experiment-run/ ← Run CRUD
│     ├─ experiments/running/        ← GET running runs (used by workers)
│     ├─ memory/project/             ← Project-scoped AI memory
│     ├─ memory/user/                ← User-scoped AI memory
│     └─ agent-session/[projectKey]/ ← Agent session proxy
├─ lib/
│  ├─ stats/
│  │  ├─ analyze.ts        ← Bayesian A/B orchestrator
│  │  ├─ bandit.ts         ← Thompson sampling (multi-armed bandit)
│  │  ├─ bayesian.ts       ← Beta-Binomial + Normal math
│  │  ├─ track-client.ts   ← track-service HTTP client
│  │  └─ types.ts          ← Metric types
│  ├─ memory/
│  │  ├─ project-memory.ts ← Project memory read/write helpers
│  │  └─ user-project-memory.ts
│  ├─ prisma.ts            ← Prisma client singleton
│  ├─ data.ts              ← Experiment queries + mutations
│  ├─ actions.ts           ← Server actions (revalidatePath)
│  └─ stages.ts            ← Stage definitions
└─ components/             ← UI components (shadcn/ui based)
```

### Database Schema (Prisma)

**Core entities**:
- `Experiment` — top-level record (flag, env, goal, hypothesis, stage, variants, metrics)
- `ExperimentRun` — individual A/B test instance (method, observation window, results, decision, learning)
- `Activity` — append-only audit log per experiment
- `Message` — chat history per experiment

### Analysis Orchestration

**Flow** (`POST /api/experiments/{id}/analyze`):
1. Accept `runId` + optional `forceFresh`
2. Fetch metrics from track-service: `queryAllMetrics()`
   - `primaryMetricEvent` + optional `guardrailEvents[]`
3. Run `runAnalysis()` (Bayesian A/B) or `runBanditAnalysis()` in-process
4. Store `inputData` + `analysisResult` in `ExperimentRun`
5. Return JSON; if track-service is unreachable and `forceFresh=false`, return stale DB result with `stale: true`

**If `forceFresh=true`**: Reject with 503 if track-service unavailable.

### Environment Variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `TRACK_SERVICE_URL` | No | Defaults to `http://track-service:8080` |
| `NEXT_PUBLIC_SANDBOX_URL` | Build arg | Browser-reachable sandbox URL (default: `http://localhost:3100`) |
| `NEXT_PUBLIC_FEATBIT_API_URL` | Build arg | FeatBit backend for auth (default: `https://app-api.featbit.co`) |

---

## 2️⃣ modules/track-service — Event Ingest & Query (.NET 10)

**Language**: C# (.NET 10 Web API)  
**Port** (docker): 5050 → 8080  
**Storage**: ClickHouse (`featbit.flag_evaluations` + `featbit.metric_events`)

### Responsibilities

Replaces the old `cf-worker` + `rollup-service` combo:
- **Ingest**: `POST /api/track` (batch) and `POST /api/track/event` (single) → in-memory `Channel<EventRecord>` → `BatchIngestWorker` flushes every 5s or 1 000 rows → ClickHouse
- **Query**: `POST /api/query/experiment` → ClickHouse JOIN (flag_evaluations ⋈ metric_events by user_key) → per-variant aggregates
- **Health**: `GET /health`

### Event Flow

```
POST /api/track
  → EventQueue (Channel, bounded 100k)
  → BatchIngestWorker (flush every 5s or 1000 rows)
  → ClickHouse: flag_evaluations / metric_events
```

### Query Response Shape

```json
{
  "variants": [
    { "variant": "control",   "users": 2318, "conversions": 45,
      "sumValue": 0, "sumSquares": 0, "conversionRate": 0.019 },
    { "variant": "treatment", "users": 2318, "conversions": 61,
      "sumValue": 0, "sumSquares": 0, "conversionRate": 0.026 }
  ]
}
```

### Environment Variables

| Variable | Default | Notes |
|---|---|---|
| `CLICKHOUSE_CONNECTION_STRING` | — | Full ADO.NET connection string |
| `ClickHouse:Database` | `featbit` | |
| `Ingest:BatchSize` | `1000` | Rows before forced flush |
| `Ingest:FlushIntervalMs` | `5000` | Time-based flush trigger |

### One-time Schema Setup

```bash
clickhouse-client ... --queries-file modules/track-service/sql/schema.sql
```

---

## 3️⃣ modules/sandbox — Claude Code Agent (SSE)

**Language**: TypeScript (Node.js + Express)  
**Port** (docker): 3100 → 3000  
**Type**: Server-Sent Events streaming

### Responsibilities

- Hosts the Claude Code agent via `@anthropic-ai/claude-agent-sdk`
- Routes to release-decision skills (CF-01 through CF-08)
- Syncs experiment state back to web via `SYNC_API_URL` (`http://web:3000`)
- Reads project memory via `MEMORY_API_BASE` (`http://web:3000`)

### Key Files

```
modules/sandbox/src/
├─ server.ts        ← Express app, /query router, /health
├─ agent.ts         ← claude-agent-sdk query runner
├─ prompt.ts        ← Builds effective prompt per session
├─ session-id.ts    ← projectId ↔ UUID session mapping
├─ session-store.ts ← In-memory session state
├─ sse.ts           ← SSE helpers
└─ routes/query.ts  ← POST /query handler
```

Skills mounted at runtime:
- `../skills/` → `/root/.claude/skills/` (read-only volume mount)

### SSE Endpoint

```
POST http://localhost:3100/query
{ "projectId": "exp-123", "message": "analyze the results" }
```

Response: SSE stream with agent thoughts, tool calls, and final answer.

### Environment Variables

| Variable | Notes |
|---|---|
| `GLM_API_KEY` | Zhipuai key (routes Claude through GLM) |
| `SYNC_API_URL` | `http://web:3000` (inside docker network) |
| `MEMORY_API_BASE` | `http://web:3000` |
| `PORT` | Default: 3000 |
| `CORS_ORIGINS` | Default: `*` |

---

## 4️⃣ modules/project-agent — Project-Level AI Assistant (SSE)

**Language**: TypeScript (Node.js, Codex CLI)  
**Port** (docker): 3031  
**Type**: Server-Sent Events streaming

### Responsibilities

- Project onboarding assistant powered by OpenAI Codex CLI
- Reads and writes shared project memory via `MEMORY_API_BASE`
- Per-session env vars: `FEATBIT_PROJECT_KEY`, `FEATBIT_USER_ID`

### Key Files

```
modules/project-agent/src/
├─ server.ts        ← Express, /query route
├─ agent.ts         ← Codex CLI wrapper
├─ prompt.ts        ← Builds system prompt with project context
├─ session-store.ts ← In-memory session tracking
└─ sse.ts           ← SSE helpers
```

Skills in `modules/project-agent/skills/` — loaded on demand.

### Environment Variables

| Variable | Notes |
|---|---|
| `OPENAI_API_KEY` | Required for Codex |
| `MEMORY_API_BASE` | `http://web:3000` |
| `PORT` | Default: 3031 |
| `CODEX_HOME` | `/app/codex-config` (volume-mounted) |

---

## 5️⃣ modules/run-active-test-worker — Synthetic Data Generator (Cloudflare Worker)

**Language**: TypeScript (Cloudflare Workers)  
**Trigger**: Cron, every minute  
**Target**: `POST {WORKER_URL}/api/track`

### Responsibilities

Feeds synthetic flag evaluation + metric events to track-service for the `run-active-test` canary experiment. Also acts as an end-to-end health probe — if track-service is down, this worker surfaces fetch errors in Cloudflare logs.

### What It Sends

Each cron tick fires 12 bursts (5s apart). Each burst sends 0–10 `TrackPayload` objects:
- 1 flag eval: `run-active-test` flag, control/treatment 50/50
- Maybe a `checkout-completed` event (control 15%, treatment 20%)
- Maybe a guardrail event (`page-load-error` / `rage-click` / `session-bounce`)

### Environment Variables (wrangler.jsonc `vars`)

| Variable | Default | Notes |
|---|---|---|
| `WORKER_URL` | `https://data-process.featbit.ai` | Track-service public URL |
| `ENV_ID` | `rat-env-v1` | Authorization header / envId |
| `BURSTS_PER_INVOCATION` | `12` | |
| `BURST_INTERVAL_MS` | `5000` | |
| `MAX_EVENTS_PER_BURST` | `10` | |

### Deploy

```bash
cd modules/run-active-test-worker
npm run deploy
```

---

## 🐳 Docker Compose

All services (except the Cloudflare Worker) run via `modules/docker-compose.yml`.

```
modules/
  docker-compose.yml
  .env                ← DATABASE_URL, CLICKHOUSE_CONNECTION_STRING, GLM_API_KEY, OPENAI_API_KEY, …
```

### Service Map

| Service | Image | Host port | Depends on |
|---|---|---|---|
| `track-service` | `featbit/track-service:local` | 5050 | ClickHouse |
| `run-active-test` | `featbit/run-active-test:local` | — | track-service (healthy) |
| `agent-sandbox` | `featbit/agent-sandbox:local` | 3100 | — |
| `project-agent` | `featbit/project-agent:local` | 3031 | web (healthy) |
| `web` | `featbit/web:local` | 3000 | track-service (healthy), agent-sandbox |

### Start / Stop

```bash
cd modules

# Start all services
docker compose up -d

# Rebuild a specific service after code changes
docker compose build web && docker compose up -d web

# Tail logs
docker compose logs -f web
docker compose logs -f track-service

# Stop
docker compose down
```

---

## 📡 API Contracts

### web → track-service

**Metrics Query** (from analysis API):
```bash
POST http://track-service:8080/api/query/experiment
Content-Type: application/json

{
  "envId":       "pricing-env-123",
  "flagKey":     "pricing-page",
  "metricEvent": "page_view",
  "startDate":   "2026-04-01",
  "endDate":     "2026-04-14",
  "metricType":  "binary",        // required; "binary" | "continuous"
  "metricAgg":   "once"           // required; "once" | "count" | "sum" | "average"
}
```

All six fields are required — track-service rejects requests missing any of
them with a 400. `metricType` decides both the per-user SQL contribution
column (binary → 0/1; count → events per user; sum → Σ values;
average → mean per user) and the response shape track-client returns to the
analyzer (`{n, k}` for binary, `{n, sum, sum_squares}` for continuous).

### track-service → ClickHouse

Direct ADO.NET connection. Schema lives in `modules/track-service/sql/schema.sql`.

### sandbox / project-agent → web (Memory + Sync)

```bash
# Read project memory
GET http://web:3000/api/memory/project/{projectKey}

# Write project memory
POST http://web:3000/api/memory/project/{projectKey}

# Sync experiment state
POST http://web:3000/api/experiments/{id}/state
POST http://web:3000/api/experiments/{id}/activity
```

---

## 📐 Metric Vocabulary & Storage Layout

> **Single canonical vocabulary** across all writers (UI, agent skills, REST API)
> and all readers (analysis engine, track-service queries). One spelling per
> concept — never two. The legacy `numeric` / `last` values are gone.

### Canonical enums

| Field | Values |
|---|---|
| `metricType` | `binary` \| `continuous` |
| `metricAgg`  | `once` \| `count` \| `sum` \| `average` |
| `direction`  (guardrail only) | `increase_bad` \| `decrease_bad` |
| `inverse`    (guardrail only, derived) | `true` ⇔ `direction === "decrease_bad"` |

Read paths tolerate the legacy `numeric` spelling and normalise to
`continuous` so old experiments keep loading. Write paths only emit the
canonical values.

Enforced in:

- `modules/web/src/app/api/experiments/[id]/experiment-run/route.ts` — POST validator (`VALID_METRIC_TYPES`, `VALID_METRIC_AGG`)
- `skills/project-sync/scripts/sync.ts` — `validateMetricObject` (state JSON) and the `--primaryMetricType` / `--primaryMetricAgg` flag handlers (run columns)
- `modules/web/src/lib/data.ts` — `parseGuardrailDefs`, `propagateMetricsToLatestRun` normalisation helpers

### Two storage locations, one fan-out contract

Metric definitions live in **two** places:

```
Experiment row             ExperimentRun row
─────────────────          ──────────────────────────
primaryMetric  (JSON) ───► primaryMetricEvent  (string)
                           primaryMetricType   (canonical enum)
                           primaryMetricAgg    (canonical enum)
                           metricDescription   (string)

guardrails     (JSON) ───► guardrailEvents     (GuardrailDef[] JSON)
```

The Experiment-level JSON is the **setup truth** (what the user/agent declared
in the wizard or via `update-state`). The ExperimentRun columns are the
**analysis truth** (what `/api/experiments/[id]/analyze` reads). Any setup-side
write **must** propagate to the latest run row, otherwise the analyzer keeps
using stale or default values and the user's edits silently disappear.

The propagation helper is `propagateMetricsToLatestRun(experimentId, fields)` in
`modules/web/src/lib/data.ts`. It is called from:

- `updateMetricsAction` in `lib/actions.ts` (Edit Metrics dialog)
- `saveExpertSetupAction` writes the run columns directly (no helper needed)
- `PUT /api/experiments/[id]/state` (the agent's `update-state` path)

When adding a new write site for `Experiment.primaryMetric` or `Experiment.guardrails`, call this helper. When adding a new read site, prefer `parseGuardrailDefs` over manually splitting strings — it handles the legacy `string[]` shape too.

### Run-side guardrails carry full definitions

`ExperimentRun.guardrailEvents` was historically a bare `string[]` of event
names. It now stores the rich shape:

```json
[
  {"event": "checkout_abandoned", "metricType": "binary",     "metricAgg": "once",  "inverse": false},
  {"event": "support_chat_open",  "metricType": "continuous", "metricAgg": "count", "inverse": false}
]
```

`parseGuardrailDefs` accepts both shapes for back-compat. The analyzer reads
this column directly, so guardrail `metricAgg` and `inverse` propagate to
`runAnalysis()` even on the live track-service path (where the heuristic in
`track-client.ts` cannot infer them from the response).

---

## 🔍 Troubleshooting

### Analysis returns no data

1. Check track-service health: `curl http://localhost:5050/health`
2. Verify ClickHouse connection string in `.env`
3. Check events were ingested: look for `[BatchIngestWorker]` log lines in `docker compose logs track-service`
4. Verify `run-active-test` container is running and sending events

### track-service won't start

- Most likely cause: missing or wrong `CLICKHOUSE_CONNECTION_STRING`
- Verify ClickHouse schema was applied: `sql/schema.sql`
- Check Docker logs: `docker compose logs track-service`

### Agent sandbox not responding

- Check `docker compose logs agent-sandbox`
- Verify `GLM_API_KEY` is set in `.env`
- Confirm the browser is hitting `http://localhost:3100` (not the internal docker name)

### Analysis results show `stale: true`

- track-service is unreachable at query time
- Check `docker compose ps` — all services should show `healthy` or `running`
- Manually refresh: click "Refresh Latest Analysis" in the UI

---

## 📊 Monitoring

- **track-service ingestion**: `docker compose logs -f track-service` — watch `[BatchIngestWorker] flushed N rows`
- **web analysis latency**: Application logs for `POST /api/experiments/{id}/analyze`
- **agent-sandbox**: `docker compose logs -f agent-sandbox`
- **run-active-test worker**: Cloudflare Dashboard → Workers → Cron Triggers → Logs

---

## ✅ After completing any task

Pick the lightest verification that actually proves the change. Don't reach for docker compose by default — it's a 5-10 minute step that's only worth it when *integration across services* is what you're verifying.

### Single-service changes (the common case)

Use the language-native dev loop:

| Service | Local loop |
|---|---|
| `modules/web` | `npm run dev` (Next.js HMR) — or `npx tsc --noEmit` + `npm run lint` for compile-time only |
| `modules/track-service` | `dotnet run` from the project directory |
| `modules/sandbox` / `modules/project-agent` | `npm run dev` in the module |
| `modules/run-active-test-worker` | `npm run dev` (wrangler dev) |

For most code changes, `tsc --noEmit` (or `dotnet build`) plus a hand-exercised dev server is all the smoke test you need.

### Cross-service / production-like verification

Reach for docker compose when:
- the change spans more than one service (e.g. web ↔ track-service contract change)
- you need realistic networking (envoy, ingress, container DNS)
- you're reproducing a prod-only bug

```bash
cd modules

# Rebuild + restart a single service
docker compose build web && docker compose up -d web

# Or rebuild all
docker compose build && docker compose up -d
```

Inside docker, the running container still has the OLD code until you rebuild — easy footgun if you forget.

---

**Last Updated**: April 2026
