# AGENTS.md — FeatBit Release Decision Agent

> Architecture, service map, and operational guide. Day-to-day development uses
> each service's native dev loop (`npm run dev`, `dotnet run`); docker compose
> is for cross-service integration and prod-like reproductions, not the default.

**Sub-documents** — read these for deep-dives on specific topics:

| Topic | File |
|---|---|
| Auth & security model, guard functions, agent tokens, route protection map | [`modules/web/AUTH.md`](modules/web/AUTH.md) |
| Helm chart, cloud deployment, AKS examples | [`charts/README.md`](charts/README.md) |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  modules/web  (Next.js + Prisma)  :3000                     │
│  Dashboard + REST API + Analysis Engine + Memory API        │
│  + server-side /api/sandbox0/* (Managed-mode chat proxy)    │
└──────┬──────────────────────────────────────────────────────┘
       │ TRACK_SERVICE_URL
       ↓
┌─────────────────────┐
│  modules/track-     │
│  service (.NET 10)  │
│  :5050 → :8080      │
│  POST /api/track    │
│  POST /api/query/   │
│       experiment    │
│  GET  /health       │
└──────────┬──────────┘
           ↑
┌──────────────────────┐
│  modules/run-active- │
│  test-worker         │
│  (Cloudflare Worker) │
│  Cron: every minute  │
│  → POST /api/track   │
└──────────────────────┘

Browser-side chat paths (chosen at runtime by the user):
  Managed mode  → web /api/sandbox0/*   → sandbox0 Managed Agents (cloud)
  Local mode    → http://127.0.0.1:3100 → @featbit/experimentation-claude-code-connector
                                          (npm package, runs on the user's
                                           own machine, fronts local Claude
                                           Code CLI via claude-agent-sdk)

Storage:
  PostgreSQL (Azure)  ← web/Prisma
  ClickHouse          ← track-service read/write
```

The runtime services (web, track-service, run-active-test) are wired together in `modules/docker-compose.yml`. The local-mode connector is published to npm and is **not** part of `docker compose` — each end user runs it themselves on their own machine.

---

## 1️⃣ modules/web — Next.js Dashboard & API

**Language**: TypeScript (Next.js 16 App Router)  
**Port** (docker): 3000  
**DB**: PostgreSQL via Prisma ORM

### Responsibilities

- **UI**: Experiment dashboard, wizard stages (intent → hypothesis → exposure → measurement → analysis → decision → learning)
- **REST API**: Experiment / run CRUD, activity log, memory
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
│     └─ memory/user/                ← User-scoped AI memory
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
| `DATABASE_URL` | Yes (runtime) | PostgreSQL connection string |
| `TRACK_SERVICE_URL` | No (runtime) | Defaults to `http://track-service:8080` |
| `SANDBOX0_API_KEY` | Yes (runtime, Managed mode) | Auth for sandbox0 Managed Agents (server-side; the `/api/sandbox0/*` routes use it). Used by the chat panel's "Managed" mode. |
| `SANDBOX0_BASE_URL` | No (runtime) | Defaults to `https://agents.sandbox0.ai` |
| `FEATBIT_API_URL` | No (runtime) | FeatBit backend for auth (default: `https://app-api.featbit.co`). Server-only — never sent to the browser. |

The chat panel's "Managed" vs "Local Claude Code" toggle is per-browser localStorage (key `featbit:agent-mode`); there is no compile-time env var. Local mode hits `http://127.0.0.1:3100` directly and requires no server-side configuration — the user installs `npx @featbit/experimentation-claude-code-connector` themselves.

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

## 3️⃣ Local Claude Code chat path

The chat panel's "Local Claude Code" mode connects the browser directly to a process running on the user's own machine — there is no FeatBit-hosted service in this path.

### Hosted side (`modules/web`)

- `src/hooks/use-local-agent-chat.ts` — fetches `http://127.0.0.1:3100/query` over SSE, parses the same event shape the legacy sandbox emitted (`stream_event` / `message` / `result` / `tool_progress` / `system` / `error` / `done`)
- `src/lib/agent-mode.ts` — `useSyncExternalStore`-backed localStorage toggle (`featbit:agent-mode`); also broadcasts changes within the same tab via a `CustomEvent`
- `src/components/experiment/chat-panel.tsx` — outer `ChatPanel` reads the mode and mounts either `ManagedChatPanel` (uses `useSandbox0Chat`) or `LocalChatPanel` (uses `useLocalAgentChat`); both feed the shared `ChatPanelView`. Re-mount on mode switch keeps the rules-of-hooks invariant intact
- `src/lib/actions.ts` — `fetchMessagesAfterAction(experimentId, afterIso)` returns the DB delta; `persistMessagesAction` returns `{ latestCreatedAt }` so the hook can advance its sync cursor in one round-trip

### Local side (`modules/experimentation-claude-code-connector`)

Published as **`@featbit/experimentation-claude-code-connector`** on npm. Users install via:

```sh
npx @featbit/experimentation-claude-code-connector
```

The connector wraps the user's locally-installed Claude Code CLI via `@anthropic-ai/claude-agent-sdk`'s `query()`. By default:

- Listens on `127.0.0.1:3100` (loopback only)
- CORS-allows `https://app.featbit.ai`, `https://featbit.ai`, `http://localhost:3000`
- `permissionMode: "bypassPermissions"` (the SDK can't show interactive permission prompts in headless mode; the loopback-only bind makes this trust posture equivalent to running `claude --dangerously-skip-permissions` directly)

Source layout:

```
modules/experimentation-claude-code-connector/src/
├─ bin/cli.ts       ← argv + env parsing, entry point published as the bin
├─ server.ts        ← Express app, /query router, /health, EPIPE guard
├─ agent.ts         ← claude-agent-sdk query() runner; resume/create flip
├─ prompt.ts        ← Bootstrap slash command (/featbit-release-decision …)
├─ session-id.ts    ← experimentId → deterministic UUID v5
├─ session-store.ts ← In-memory active-session bookkeeping
├─ sse.ts           ← SSE helpers
├─ routes/query.ts  ← POST /query handler
└─ types.ts         ← QueryRequestBody, ActiveSession, SseEventName
```

The connector is **not** part of `docker compose` — each user runs it on their own machine, and it talks to skills mounted under `~/.claude/skills/` (loaded via `settingSources: ["user", "project"]`).

### Cross-user sync model

The agent's working memory (`~/.claude/projects/<encoded-cwd>/<uuid>.jsonl`) is per-machine. Two users on the same experiment have independent jsonl files, but PostgreSQL is the canonical conversation log. Before each user prompt, `useLocalAgentChat`:

1. Fetches DB messages newer than its `featbit:local-agent-msg-cursor:<experimentId>` localStorage cursor
2. If the delta is non-empty, prepends it to the prompt as a markdown transcript with a clear header so the model treats it as conversation history
3. Optimistically advances the cursor to the delta's latest `createdAt` so a fast-follow send doesn't re-prepend
4. After the stream finishes, calls `persistMessagesAction` and advances the cursor to include the just-written pair

This is why a fresh user opening a long-running experiment will see a long prepended block on their first send — that's the entire DB history being replayed into their local jsonl on demand.

### Bootstrap slash command

When the user prompt is empty, the connector emits `/featbit-release-decision <experimentId> <accessToken>`, which loads the `featbit-release-decision` skill from `~/.claude/skills/`. That skill's `project-sync` subskill calls back into the web's REST API to load experiment state. Without this slash command on the first turn, the agent wakes up with no knowledge of what experiment it's looking at.

### Environment variables (connector shell)

Set these in the shell **before** running `npx @featbit/experimentation-claude-code-connector`. The connector process inherits them, and Claude Code inherits them when running bash tools (including `sync.ts`).

| Variable | Default | Notes |
|---|---|---|
| `ACCESS_TOKEN` | _(empty)_ | **Required.** Agent token (`fbat_…`) issued from `/data/env-settings`. Passed as `Authorization: Bearer` by `sync.ts` on every web API call. |
| `SYNC_API_URL` | `https://www.featbit.ai` | Override for local dev: `http://localhost:3000`. |
| `PORT` | `3100` | Listen port for the connector SSE server. |
| `HOST` | `127.0.0.1` | Bind address — keep on loopback. |
| `CORS_ORIGINS` | `https://app.featbit.ai,https://featbit.ai,http://localhost:3000` | Comma-separated, or `*` to allow any origin. |
| `PERMISSION_MODE` | `bypassPermissions` | `default` blocks headless (no TTY for interactive prompt). |

### Deprecated: `modules/sandbox/`

The pre-connector containerised sandbox lives at `modules/sandbox/`. It is no longer started by `docker compose` and is kept only as a code reference. Do not add new features there — make changes in `modules/experimentation-claude-code-connector/` and cut a new npm release.

---

## 4️⃣ modules/run-active-test-worker — Synthetic Data Generator (Cloudflare Worker)

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

Two compose files, layered:

| File | Purpose | Image source |
|---|---|---|
| `modules/docker-compose.yml` | Production-ish default. Pull and run published images. | Docker Hub (`featbit/featbit-rda-{web,track-service}:${VERSION}`) |
| `modules/docker-compose.local.yml` | Local debug overlay. Builds from source, routes web at the in-network track-service, adds `run-active-test` for synthetic events. | Local build (`featbit/featbit-rda-*:local`) |

```
modules/
  docker-compose.yml
  docker-compose.local.yml
  .env                ← DATABASE_URL, CLICKHOUSE_CONNECTION_STRING, SANDBOX0_API_KEY, TRACK_SERVICE_SIGNING_KEY, …
```

### Service map

| Service | Defined in | Image (default mode) | Host port | Depends on |
|---|---|---|---|---|
| `track-service` | base | `featbit/featbit-rda-track-service:${VERSION}` | 5050 | external ClickHouse |
| `web` | base | `featbit/featbit-rda-web:${VERSION}` | 3000 | track-service (when local overlay) |
| `run-active-test` | local overlay only | `featbit/run-active-test:local` (build-only) | — | track-service (healthy) |

The `Local Claude Code` chat path is **not** a docker service — users run `npx @featbit/experimentation-claude-code-connector` on their own machines.

### Start / Stop

```bash
cd modules

# Default mode — pull and run published images:
export VERSION=0.0.2-beta            # whichever tag you want; defaults are pinned in docker-compose.yml
docker compose pull
docker compose up -d

# Local debug — build from source + in-network routing + run-active-test:
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build

# Tail logs
docker compose logs -f web
docker compose logs -f track-service

# Stop (works in either mode)
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

### Local agent → web (experiment sync via `sync.ts`)

All routes below require authentication. Session callers (browser) use the `fb_session` cookie. Headless callers (`sync.ts`) pass an agent token as `Authorization: Bearer fbat_…`.

Agent tokens are per-project scoped — a token issued for project A cannot write to an experiment in project B. Issue tokens at `/data/env-settings` → **Agent tokens**.

```bash
# Experiment state (requireAuthForExperiment — agent token OK)
GET  http://web:3000/api/experiments/{id}
PUT  http://web:3000/api/experiments/{id}/state
PUT  http://web:3000/api/experiments/{id}/stage
POST http://web:3000/api/experiments/{id}/activity
POST http://web:3000/api/experiments/{id}/experiment-run

# Memory (requireAuth — browser session only)
GET  http://web:3000/api/memory/project/{projectKey}
POST http://web:3000/api/memory/project/{projectKey}
```

See [`modules/web/AUTH.md`](modules/web/AUTH.md) for the full route protection map and guard function details.

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

### Managed-mode chat not responding

- Check `docker compose logs web` for errors from `/api/sandbox0/*` routes
- Verify `SANDBOX0_API_KEY` and `SANDBOX0_BASE_URL` are set in `.env`
- Confirm the chat panel's mode selector is on **Managed** (top-right of the chat)

### Local-Claude-Code mode not connecting

- Confirm the user has run `npx @featbit/experimentation-claude-code-connector` and that its banner says `Listening at http://127.0.0.1:3100`
- Check the connector's terminal for `[agent]` log lines on each request
- If the agent stalls and reports "permission required", verify `PERMISSION_MODE` is `bypassPermissions` (the connector's startup banner prints the active value)
- Confirm the browser origin is in the connector's CORS allowlist (default covers `app.featbit.ai`, `featbit.ai`, and `localhost:3000`); override via `CORS_ORIGINS` if running web from a custom host
- If the chat panel's "Local agent" status card shows the install command, the browser cannot reach the connector at `127.0.0.1:3100` — usually the connector is not running, or the user is on the wrong port

### Analysis results show `stale: true`

- track-service is unreachable at query time
- Check `docker compose ps` — all services should show `healthy` or `running`
- Manually refresh: click "Refresh Latest Analysis" in the UI

---

## 📊 Monitoring

- **track-service ingestion**: `docker compose logs -f track-service` — watch `[BatchIngestWorker] flushed N rows`
- **web analysis latency**: Application logs for `POST /api/experiments/{id}/analyze`
- **Managed-mode chat**: `docker compose logs -f web` — look for `/api/sandbox0/*` route logs
- **Local-mode chat**: the connector's own terminal output on the user's machine
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
| `modules/experimentation-claude-code-connector` | `npm run dev` (tsx watch) — only when modifying the connector itself; end-user verification is `npx @featbit/experimentation-claude-code-connector` from outside the repo |
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

**Last Updated**: May 2026
