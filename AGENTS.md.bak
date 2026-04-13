# AGENTS.md — FeatBit Release Decision Agent

> Coding-agent reference. Read this before touching any service.
> For the full product narrative see README.md.

---

## Repository at a Glance

A mono-repo that delivers an end-to-end product-experimentation system built on the loop:

```
intent → hypothesis → implementation → exposure → measurement → decision → learning
```

Four runtime services collaborate at runtime:

| Service | Language | Role |
|---|---|---|
| `agent/web` | TypeScript / Next.js 16 | Web UI + REST API + Prisma ORM |
| `agent/data` | C# / .NET 10 | Event ingest + Bayesian analysis worker |
| `agent/simulator` | C# / .NET 10 | Synthetic traffic generator (dev/test) |
| `agent/sandbox` | TypeScript / Node.js | SSE bridge for the Claude Agent SDK |

One shared database: **PostgreSQL** (single instance, two logical schemas — Prisma tables + raw event tables).

---

## Service Map

### `agent/web` — Next.js Web App

**Port:** 3000  
**Purpose:** The primary user-facing application. Serves the experiment dashboard and exposes the HTTP API consumed by agent skills.

**Key internals:**

```
src/
  app/
    (dashboard)/        ← dashboard pages (experiments list, project overview)
    (project)/          ← per-project pages (intent, hypothesis, metrics, results)
    api/
      projects/[id]/    ← REST: project CRUD, state, stage, activity, experiment
      experiments/      ← REST: experiment list, running experiments health-check
  components/
    ui/                 ← shadcn/ui primitives only — do NOT create custom equivalents
  hooks/                ← custom React hooks
  lib/                  ← utilities, API clients, shared types
  generated/prisma/     ← Prisma client (auto-generated — never hand-edit)
prisma/
  schema.prisma         ← canonical data model (Project, Experiment, Activity, Message)
  migrations/           ← applied migration history
  seed.ts               ← dev seed data
```

**Data model highlights (schema.prisma):**
- `Project` — top-level container; holds stage (`intent` → `hypothesis` → `implementing` → `measuring` → `learning`), decision state fields (`goal`, `hypothesis`, `primaryMetric`, `lastLearning`, etc.), and FeatBit flag config.
- `Experiment` — one A/B run inside a project; stores variant config, traffic allocation, Bayesian priors, and analysis results.
- `Activity` — append-only audit log per project (each agent step appends an entry).
- `Message` — chat message log per project.

**Critical rules:**
- Next.js 16 App Router — read `node_modules/next/dist/docs/` before writing routing or data-fetching code.
- Server Components by default; `"use client"` only for browser APIs / state / event handlers.
- Import alias: `@/*` → `src/`.
- Prisma client is in `src/generated/prisma` — import from there, not from `@prisma/client`.
- Database URL comes from `DATABASE_URL` env var; defined in `prisma.config.ts`.

---

### `agent/data` — .NET Data Server

**Port:** 5058  
**Purpose:** Receives raw telemetry (flag evaluations and metric events) via HTTP, buffers through in-memory channels, batch-writes to PostgreSQL, and runs a periodic Bayesian analysis worker.

**Key internals:**

```
Endpoints/
  TrackEndpoints.cs       ← POST /api/track  (flag evals + metric events)
Services/
  EventChannel.cs         ← System.Threading.Channels bus (no Redis/Kafka dependency)
  FlagEvalConsumer.cs     ← background: drains flag-eval channel → PG COPY
  MetricEventConsumer.cs  ← background: drains metric channel → PG COPY
  MetricCollector.cs      ← queries aggregated metrics from PG for experiments
  ExperimentWorker.cs     ← timed loop: fetches running experiments from web API,
                             invokes PythonAnalyzer, POSTs results back to web API
  PythonAnalyzer.cs       ← spawns python3 with analyze-bayesian.py
  EnvAuth.cs              ← validates Authorization header = env secret
Scripts/
  analyze-bayesian.py     ← Bayesian A/B analysis (Beta-Binomial or Normal)
  stats_utils.py          ← HDI, ROPE, probability-of-being-best helpers
  db_client.py            ← reads raw events from PG for the Python script
  init-db.sql             ← DDL for event tables (flag_evaluations, metric_events)
```

**Data flow:**
```
POST /api/track
  → EnvAuth validates secret
  → payload routed to EventChannel (flag_eval | metric_event)
  → FlagEvalConsumer / MetricEventConsumer batch-flush to PG

ExperimentWorker (every N seconds)
  → GET web:3000/api/experiments/running
  → MetricCollector aggregates raw events from PG
  → PythonAnalyzer runs analyze-bayesian.py
  → POST web:3000/api/experiments/{id}/result
```

**Critical rules:**
- `EventChannel` is the only message bus — no Redis, no Kafka.
- `ExperimentWorker__ApiBaseUrl` env var must point to the web service.
- Python 3 must be available in the container (`python3` by default; override via `ExperimentWorker__PythonPath`).
- Event tables are **not** in the Prisma schema — they are created by `init-db.sql` / `docker/init-events.sql`.

---

### `agent/simulator` — Traffic Simulator

**Purpose:** Sends synthetic flag evaluations and metric events to the data server at a configurable rate and conversion split. Used for local development and E2E testing — not deployed in production.

**Key behaviour:**
- Runs a continuous loop: generate N users per batch, assign each to control/treatment, fire a flag-eval event, then probabilistically fire a metric event (conversion).
- All parameters set via env vars: `TRACK_API_URL`, `FLAG_KEY`, `BATCH_SIZE`, `BATCH_DELAY_MS`, `CONTROL_CONV_RATE`, `TREATMENT_CONV_RATE`.
- Stopped by Ctrl+C / SIGTERM (clean cancellation via `CancellationTokenSource`).

---

### `agent/sandbox` — Claude Code Agent Bridge

**Purpose:** A TypeScript Express server that hosts a **Claude Code** agent and exposes it over SSE. The agent is powered by `@anthropic-ai/claude-agent-sdk` with `systemPrompt: { preset: "claude_code" }` — meaning Claude Code is the runtime, not a generic chat model.

**Agent entry point:**  
Every new session sends the slash command `/featbit-release-decision <projectId> <accessToken>` as its first prompt. The SDK resolves that to the `featbit-release-decision` SKILL.md registered in `~/.claude/skills/`, which is the hub skill that routes all subsequent turns to satellite skills in `skills/`.

**Session continuity:**  
Each project gets a stable UUID (`projectIdToSessionId`). Resumed sessions skip the slash command and pass the user prompt through directly, preserving Claude Code's conversation memory across HTTP requests.

```
src/
  server.ts       ← Express + SSE endpoint
  agent.ts        ← claude-agent-sdk query runner; allowed tools: Bash, Read, Write,
                    Edit, Glob, Grep, WebFetch, WebSearch, Skill
  prompt.ts       ← builds effective prompt: slash command (new) or passthrough (resume)
  session-id.ts   ← projectId → UUID mapping + known-session registry
data/             ← local JSON files readable by agent scripts
scripts/          ← standalone .ts scripts runnable with `tsx`
```

**Skill wiring:**  
`skills/featbit-release-decision/SKILL.md` is the hub. All other skills under `skills/` are satellite skills invoked by the hub based on current project stage (CF-01 … CF-08).

**Critical rules:**
- All source files use ES module syntax (`import`/`export`) — no `require`.
- Credentials via env vars only — never hard-code secrets.
- Scripts in `scripts/` are plain `.ts` files; run with `npx tsx scripts/<file>.ts`.

---

## Skills Directory (`skills/`)

Agent skill definitions (Markdown). Each sub-folder is one skill loaded by VS Code Copilot / Claude.

| Skill | Trigger (CF) | What it does |
|---|---|---|
| `featbit-release-decision` | hub | Entry point; routes to all satellite skills based on user intent and current stage |
| `intent-shaping` | CF-01 | Clarifies vague goals into measurable outcomes |
| `hypothesis-design` | CF-02 | Converts goal into falsifiable causal hypothesis |
| `reversible-exposure-control` | CF-03/04 | Designs feature flag + rollout strategy |
| `measurement-design` | CF-05 | Defines primary metric, guardrails, event schema |
| `experiment-workspace` | CF-05+ | Creates and manages experiment records; runs stats |
| `evidence-analysis` | CF-06/07 | Interprets collected data → CONTINUE / PAUSE / ROLLBACK / INCONCLUSIVE |
| `learning-capture` | CF-08 | Captures structured learning at cycle end |
| `project-sync` | all | CLI (`scripts/sync.ts`) that persists state to web DB via HTTP |

**project-sync contract:**
```
npx tsx scripts/sync.ts <command> [args]
```
Commands: `get-project`, `update-state`, `set-stage`, `add-activity`, `upsert-experiment`.  
All paths are relative to the `skills/project-sync/` root.  
Transport: HTTP → `agent/web` API → Prisma → PostgreSQL.

---

## Infrastructure

### `docker-compose.yml`

Brings up the full stack for local development and E2E testing:

```
postgres   (port 5433 host → 5432 container) — shared DB
web        (port 3000) — depends on postgres:healthy
data       (port 5058) — depends on web:healthy
simulator  (no exposed port) — depends on data:healthy
```

Start everything:
```bash
docker compose up --build
# open http://localhost:3000
```

### `docker/init-events.sql`

DDL executed at container startup to create the raw event tables (`flag_evaluations`, `metric_events`) inside the shared `release_decision` database. This is **not** managed by Prisma migrations.

---

## Database Layout

Single PostgreSQL instance, single database `release_decision`.

| Tables | Managed by | Purpose |
|---|---|---|
| `project`, `experiment`, `activity`, `message` | Prisma migrations | Application state, agent decision state |
| `flag_evaluations`, `metric_events` | `docker/init-events.sql` | Raw telemetry written by data server |

Connection string pattern: `postgresql://postgres:postgres@<host>:5432/release_decision`

---

## Environment Variables Cheat Sheet

### `agent/web`
| Var | Default | Notes |
|---|---|---|
| `DATABASE_URL` | — | Required; Prisma connection string |

### `agent/data`
| Var | Default | Notes |
|---|---|---|
| `ConnectionStrings__EventStore` | `Host=localhost;Port=5432;Database=...` | Npgsql connection string |
| `ExperimentWorker__IntervalSeconds` | `10` | Analysis loop cadence |
| `ExperimentWorker__ApiBaseUrl` | `http://web:3000` | Web service base URL |
| `ExperimentWorker__PythonPath` | `python3` | Python executable |

### `agent/simulator`
| Var | Default | Notes |
|---|---|---|
| `TRACK_API_URL` | `http://localhost:5058/api/track` | Data server endpoint |
| `ENV_SECRET` | `sim-env-001` | Must match data server env config |
| `FLAG_KEY` | `onboarding-checklist` | Feature flag being simulated |
| `CONTROL_CONV_RATE` | `0.32` | Conversion probability for control variant |
| `TREATMENT_CONV_RATE` | `0.45` | Conversion probability for treatment variant |
| `BATCH_SIZE` | `5` | Users per batch |
| `BATCH_DELAY_MS` | `3000` | Delay between batches (ms) |

---

## Making Changes — Where to Look

| Task | Files to touch |
|---|---|
| Add/change a page or UI component | `agent/web/src/app/` or `agent/web/src/components/` |
| Add/change an API endpoint | `agent/web/src/app/api/` |
| Change the data model | `agent/web/prisma/schema.prisma` → run `prisma migrate dev` |
| Change event ingestion logic | `agent/data/Endpoints/TrackEndpoints.cs` + consumers |
| Change Bayesian analysis | `agent/data/Scripts/analyze-bayesian.py` + `stats_utils.py` |
| Change experiment worker cadence/logic | `agent/data/Services/ExperimentWorker.cs` |
| Change simulation parameters | `agent/simulator/Program.cs` or env vars |
| Update agent skill behaviour | `skills/<skill-name>/SKILL.md` |
| Change sync CLI | `skills/project-sync/scripts/sync.ts` |
| Change raw event table schema | `docker/init-events.sql` (then rebuild postgres container) |
