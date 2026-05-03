# FeatBit Release Decision Agent

**The A/B testing & experimentation system for FeatBit.**

A multi-service platform that turns a feature flag into a measured experiment — guiding teams through the full release-decision loop:

> intent → hypothesis → exposure → measurement → analysis → decision → learning

Powered by **Bayesian A/B testing**, **multi-armed bandits**, **FeatBit feature flags**, and **AI-assisted workflows** that drive each phase from a coding-agent-friendly skill catalog.

---

## What this project is

Most experimentation platforms are dashboards bolted onto a warehouse. This one is built around a different premise:

- **The coding agent is the primary user.** Skills under `skills/` script the workflow phases; the web UI is a viewer/editor over the same database.
- **The control plane is the feature flag.** FeatBit decides who sees what, the agent and dashboard decide what happens next.
- **Raw data stays in the customer's stack.** Events are ingested into ClickHouse; analysis runs in-process inside the web service. No third-party metric pipeline.
- **Decisions are deterministic and auditable.** Every stage transition, hypothesis edit, and analysis result is appended to an activity log per experiment.

See [`WHITE_PAPER.md`](WHITE_PAPER.md) for the product thesis.

---

## Architecture

Four services under `modules/`, a published npm bridge, plus a skill catalog and a Helm chart:

```
                    ┌──────────────────────────────────────────────┐
                    │  modules/web  (Next.js 16 + Prisma)  :3000   │
                    │  Dashboard, REST API, Bayesian/Bandit        │
                    │  analysis engine, project + user memory      │
                    │  Server-side /api/sandbox0/* → Managed Agents│
                    └────────┬───────────────┬─────────────────────┘
        TRACK_SERVICE_URL    │               │   MEMORY_API_BASE / SYNC_API_URL
                             ▼               ▼
        ┌──────────────────────────┐                              ┌────────────────────────┐
        │  modules/track-service   │                              │  modules/project-agent │
        │  (.NET 10 + ClickHouse)  │                              │  (Codex CLI, SSE)      │
        │  :5050  POST /api/track  │                              │  :3031  POST /query    │
        │         POST /api/query/ │                              │  Project onboarding +  │
        │              experiment  │                              │  shared memory         │
        └────────────┬─────────────┘                              └────────────────────────┘
                     ▲
        ┌────────────┴─────────────┐
        │  modules/run-active-     │
        │  test-worker             │
        │  (Cloudflare Worker)     │
        │  Cron: every minute      │
        │  → POST /api/track       │
        └──────────────────────────┘

Browser-only paths (chat panel chooses one at runtime):
  Managed mode → web /api/sandbox0/* → sandbox0 Managed Agents (cloud)
  Local mode   → user's browser → http://127.0.0.1:3100
                 ↑
                 npx @featbit/experimentation-claude-code-connector
                 (runs on the user's own machine, fronts their local
                  Claude Code CLI via @anthropic-ai/claude-agent-sdk)

Storage:
  PostgreSQL (Azure)   ← Prisma; experiments, runs, activity, memory, chat
  ClickHouse           ← track-service; flag_evaluations + metric_events
```

### Services at a glance

| Component | Stack | Port | Role |
|---|---|---|---|
| `modules/web` | Next.js 16, Prisma, TypeScript | 3000 | Dashboard UI, REST API, in-process analysis engine, memory API, server-side proxy to sandbox0 Managed Agents |
| `modules/track-service` | .NET 10, ClickHouse | 5050 → 8080 | Event ingest (`/api/track`) and per-experiment metric query (`/api/query/experiment`) |
| `modules/project-agent` | Node.js, OpenAI Codex CLI, SSE | 3031 | Project-level onboarding assistant; reads/writes shared project memory |
| `modules/run-active-test-worker` | Cloudflare Worker, cron | — | Synthetic event generator + end-to-end health probe for the `run-active-test` canary experiment |
| `@featbit/experimentation-claude-code-connector` ([npm](https://www.npmjs.com/package/@featbit/experimentation-claude-code-connector)) | Node.js, `@anthropic-ai/claude-agent-sdk`, Express SSE | 3100 (loopback) | Optional npm package the user runs on their own machine to expose their local Claude Code CLI to the web UI's "Local Claude Code" chat mode. Source in `modules/experimentation-claude-code-connector/`. |
| `modules/sandbox` *(deprecated)* | Node.js, Express SSE | — | Pre-connector containerised sandbox; kept for reference, no longer started by `docker compose` |

### Storage

| Store | Manager | Holds |
|---|---|---|
| **PostgreSQL** (single `release_decision` DB) | Prisma migrations in `modules/web/prisma/` | `Experiment`, `ExperimentRun`, `Activity`, `Message`, `ManagedAgent`, `Vault`, project + user memory |
| **ClickHouse** | `modules/track-service/sql/schema.sql` | `flag_evaluations`, `metric_events` (raw, joined per query) |

### Two chat modes, one UI

The chat panel inside an experiment exposes a runtime toggle (persisted per-browser in localStorage):

- **Managed** *(default)* — the browser hits web's own `/api/sandbox0/*` routes, which proxy to sandbox0 Managed Agents in the cloud. One sandbox0 session per experiment, shared across all users on that experiment. No client-side install required.
- **Local Claude Code** — the browser hits `http://127.0.0.1:3100` directly. The user must first run `npx @featbit/experimentation-claude-code-connector` on their own machine; the connector wraps the locally-installed Claude Code CLI. Per-user agent context (each user has their own `~/.claude/projects/<cwd>/<uuid>.jsonl`); the chat panel keeps everyone in sync by replaying the DB-persisted message delta into each local session before each prompt.

There is no compile-time agent backend env var. Both modes are always available; the active mode is whatever the user picked last in this browser.

---

## Repository layout

```
featbit-release-decision-agent/
├─ README.md                          ← you are here
├─ AGENTS.md                          ← deep service map, env vars, contracts
├─ WHITE_PAPER.md                     ← product thesis
├─ LICENSE
│
├─ modules/                           ← all runtime services
│  ├─ docker-compose.yml              ← prod-like four-service stack
│  ├─ docker-compose.local.yml        ← local override
│  ├─ web/                            ← Next.js dashboard + API
│  │  ├─ src/app/api/experiments/…    ← experiment CRUD, /analyze, /state, /activity
│  │  ├─ src/app/api/sandbox0/…       ← server-side proxy to Managed Agents (chat)
│  │  ├─ src/hooks/use-sandbox0-chat  ← Managed-mode chat hook
│  │  ├─ src/hooks/use-local-agent-chat ← Local-mode chat hook
│  │  ├─ src/lib/agent-mode.ts        ← localStorage runtime mode toggle
│  │  ├─ src/lib/stats/               ← analyze.ts, bandit.ts, bayesian.ts, track-client.ts
│  │  ├─ src/lib/memory/              ← project + user memory helpers
│  │  ├─ prisma/                      ← schema + migrations
│  │  └─ wrangler.jsonc               ← Cloudflare Containers config (optional path)
│  ├─ track-service/                  ← .NET 10 ingest + query
│  │  ├─ Endpoints/, Services/        ← BatchIngestWorker, query handlers
│  │  └─ sql/schema.sql               ← ClickHouse DDL
│  ├─ experimentation-claude-code-connector/
│  │                                  ← npm package source: local SSE bridge
│  │                                    that exposes the user's Claude Code CLI
│  │                                    to the web UI on 127.0.0.1:3100
│  ├─ sandbox/                        ← deprecated; kept for reference only
│  ├─ project-agent/                  ← Codex CLI SSE server
│  └─ run-active-test-worker/         ← Cloudflare cron data generator
│
├─ skills/                            ← release-decision skill catalog (mounted into sandbox)
│  ├─ featbit-release-decision/       ← hub: routes by current stage (CF-01 … CF-08)
│  ├─ intent-shaping/                 ← CF-01 clarify the goal
│  ├─ hypothesis-design/              ← CF-02 craft a falsifiable hypothesis
│  ├─ reversible-exposure-control/    ← CF-03 / CF-04 design the flag + rollout
│  ├─ measurement-design/             ← CF-05 primary metric + guardrails
│  ├─ experiment-workspace/           ← CF-05+ manage runs, trigger analysis
│  ├─ evidence-analysis/              ← CF-06 / CF-07 interpret + decide
│  ├─ learning-capture/               ← CF-08 structured postmortem
│  └─ project-sync/                   ← CLI: persist state to web DB
│
├─ charts/featbit-rda/                ← Helm chart (umbrella, per-service templates)
│  └─ examples/aks/                   ← AKS reference values + Key Vault SPC
│
├─ tutorial/                          ← Bayesian + experimentation learning notes
└─ skills-project/                    ← scaffolding for new skills
```

---

## Quick start

Day-to-day work uses each service's native dev loop. Reach for docker compose only for cross-service integration.

### Single-service dev loops

| Service | Loop |
|---|---|
| `modules/web` | `npm run dev` (Next.js HMR on :3000) |
| `modules/track-service` | `dotnet run` from the project directory (:5050) |
| `modules/experimentation-claude-code-connector` | `npm run dev` (tsx watch on :3100) — only when working on the connector itself; end users install it via `npx @featbit/experimentation-claude-code-connector` |
| `modules/project-agent` | `npm run dev` (:3031) |
| `modules/run-active-test-worker` | `npm run dev` (`wrangler dev`) |

For `modules/web`, the lightest verification is `npx tsc --noEmit && npm run lint` plus a hand-exercised dev server.

### Full stack via docker compose

```bash
cd modules

# Bring up the four runtime services (web, track-service, project-agent, run-active-test)
docker compose up -d

# Rebuild a single service after code changes
docker compose build web && docker compose up -d web

# Tail logs
docker compose logs -f web
docker compose logs -f track-service

docker compose down
```

The compose file expects a `.env` next to it with at minimum:

```
DATABASE_URL=postgresql://…/release_decision
CLICKHOUSE_CONNECTION_STRING=Host=…;Port=9000;User=…;Password=…
TRACK_SERVICE_SIGNING_KEY=<shared HMAC key>
SANDBOX0_BASE_URL=https://agents.sandbox0.ai
SANDBOX0_API_KEY=<for Managed-mode chat in web>
OPENAI_API_KEY=<for project-agent / Codex>
```

The `Local Claude Code` chat mode does not need any server-side env var — each user runs `npx @featbit/experimentation-claude-code-connector` on their own machine and the browser connects to it on `127.0.0.1:3100`.

ClickHouse and PostgreSQL are **not** provisioned by compose — point `DATABASE_URL` and `CLICKHOUSE_CONNECTION_STRING` at managed instances (Azure PostgreSQL, an Azure VM running ClickHouse, etc.). Apply the schema once with:

```bash
clickhouse-client … --queries-file modules/track-service/sql/schema.sql
```

---

## Deployment

Two supported targets:

### 1. Docker Compose (small / single-host)

`modules/docker-compose.yml` is production-shaped: every service has a healthcheck, the worker depends on track-service being healthy, and the agents wait for web. Set the `.env` above and `docker compose up -d`.

### 2. Helm on Kubernetes (recommended for prod)

A single umbrella chart in `charts/featbit-rda/` ships per-service Deployments, Services, Ingress, HPA, PDB, and Secret templates. The chart is deliberately cloud-neutral — it does not provision ClickHouse or apply DDL.

Provision before `helm install`:

1. **ClickHouse database + tables** (`schema.sql`)
2. **PostgreSQL database**
3. **A Secret holding the ClickHouse connection string** (referenced via `trackService.clickHouse.existingSecret`)

AKS reference values, NGINX ingress, cert-manager, and Azure Key Vault SecretProviderClass examples live in `charts/featbit-rda/examples/aks/`. A local Docker Desktop smoke-test profile is in `examples/local/`.

See [`charts/README.md`](charts/README.md) for the full deployment guide.

---

## How an experiment moves through the system

1. **Setup** — UI or agent creates an `Experiment` row (flag key, env, goal, hypothesis, variants, primary metric, guardrails). Skills CF-01 → CF-05 cover this phase.
2. **Exposure** — A FeatBit feature flag controls who sees what. The skill `reversible-exposure-control` produces the flag handoff. Variants emit `flag_evaluation` events to track-service.
3. **Measurement** — Application code (or `run-active-test-worker`, for the canary) emits `metric_event` rows to track-service via `POST /api/track`. ClickHouse stores both event streams.
4. **Analysis** — `POST /api/experiments/{id}/analyze` calls track-service's `/api/query/experiment`, joins flag evaluations to metric events per user, and runs Bayesian A/B (`bayesian.ts`) or Thompson-sampling bandit (`bandit.ts`) in-process. Results are stored on the `ExperimentRun` row.
5. **Decision** — `evidence-analysis` reads the run row and frames the outcome as **CONTINUE**, **PAUSE**, **ROLLBACK CANDIDATE**, or **INCONCLUSIVE**. The decision is appended to the activity log.
6. **Learning** — `learning-capture` writes a structured postmortem onto the run; the next iteration starts from evidence, not memory.

The metric vocabulary is canonical across the whole system:

| Field | Values |
|---|---|
| `metricType` | `binary` \| `continuous` |
| `metricAgg` | `once` \| `count` \| `sum` \| `average` |
| `direction` *(guardrail)* | `increase_bad` \| `decrease_bad` |

Definitions live both on `Experiment` (setup truth) and on the latest `ExperimentRun` (analysis truth); `propagateMetricsToLatestRun()` in `modules/web/src/lib/data.ts` keeps them in sync. Details and the back-compat rules for the legacy `numeric` / `last` spellings are in [`AGENTS.md`](AGENTS.md).

---

## Key API contracts

```bash
# Web → track-service: query an experiment's metrics
POST http://track-service:8080/api/query/experiment
{
  "envId":       "pricing-env-123",
  "flagKey":     "pricing-page",
  "metricEvent": "page_view",
  "startDate":   "2026-04-01",
  "endDate":     "2026-04-14",
  "metricType":  "binary",          // binary | continuous
  "metricAgg":   "once"             // once | count | sum | average
}
```

```bash
# Web: run analysis (called by UI button + sandbox skills)
POST /api/experiments/{id}/analyze
{ "runId": "exp-run-123", "forceFresh": true }
```

```bash
# Web: list running runs (used by automation / workers)
GET /api/experiments/running
```

```bash
# Sandbox / project-agent → web: project memory
GET  /api/memory/project/{projectKey}
POST /api/memory/project/{projectKey}

# Sandbox → web: experiment state + activity (project-sync skill)
POST /api/experiments/{id}/state
POST /api/experiments/{id}/activity
```

---

## Further reading

- [**AGENTS.md**](AGENTS.md) — full service map, environment variables, troubleshooting, and the canonical metric storage contract
- [**WHITE_PAPER.md**](WHITE_PAPER.md) — product thesis and market positioning
- [**charts/README.md**](charts/README.md) — Helm chart + cloud examples
- [**skills/featbit-release-decision/**](skills/featbit-release-decision/) — release-decision workflow and CF-01 → CF-08 phase definitions
- [**modules/experimentation-claude-code-connector/README.md**](modules/experimentation-claude-code-connector/README.md) — Local-mode bridge: install, config, SSE contract, publishing
- [**tutorial/**](tutorial/) — Bayesian and experimentation learning notes (EN / 中文)

---

**License**: see [`LICENSE`](LICENSE)
