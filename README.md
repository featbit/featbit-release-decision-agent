# FeatBit Experimentation

**The A/B testing & experimentation system for FeatBit.**

Turn a feature flag into a measured experiment. Every release moves through the full decision loop:

> intent → hypothesis → exposure → measurement → analysis → decision → learning

Powered by **Bayesian A/B testing**, **multi-armed bandits**, **FeatBit feature flags**, and an **AI-driven workflow** scripted by a release-decision Skills catalog.

The coding agent is a first-class user of this system — Skills under `skills/` script the workflow phases (CF-01 → CF-08); the web UI is a viewer/editor over the same database. Decisions are deterministic and auditable: every stage transition, hypothesis edit, and analysis result is appended to a per-experiment activity log.

See [`WHITE_PAPER.md`](WHITE_PAPER.md) for the product thesis.

---

## Quick Start

### Prerequisites

The FeatBit Release Decision Agent is built **on top of** the FeatBit feature-flag platform — it doesn't replace it. Before deploying RDA you need a running FeatBit instance, because the web app:

- delegates **all authentication** to FeatBit (login, workspace, project)
- reads / writes **feature flags** through FeatBit's API to drive experiment exposure

**SaaS path** — sign up at **[featbit.co](https://featbit.co)** and you're done; FeatBit + RDA are bundled.

**Self-host path** — install FeatBit first from **[github.com/featbit/featbit](https://github.com/featbit/featbit)** (Docker Compose or Helm). To point RDA's web at your FeatBit, set `FEATBIT_API_URL=https://your-featbit-api` in `modules/.env` (or `web.featbit.apiUrl` in your Helm values). It's a runtime env var — no rebuild required, the published image works against any FeatBit backend.

You'll also need:

- A reachable **PostgreSQL 14+** (web's primary store)
- A reachable **ClickHouse** *(only if you keep `track-service`)* — initialised via [`modules/track-service/sql/schema.sql`](modules/track-service/sql/schema.sql)

Step-by-step DB initialisation lives in the deployment guides below.

### Deployment

#### 1. Try it online at featbit.co

The fastest path is the hosted version: sign up at **[featbit.co](https://featbit.co)** and create an experiment from the dashboard. No install, no infrastructure.

#### 2. Self-host with Docker Compose

For a single-host install you fully control, the bundled compose stack brings up `web` + `track-service` against your own PostgreSQL and ClickHouse:

```bash
cd modules
# create .env with DATABASE_URL, CLICKHOUSE_CONNECTION_STRING, TRACK_SERVICE_SIGNING_KEY
# (see docs/deployment/docker.md for the full template)
docker compose up -d
```

Open [http://localhost:3000](http://localhost:3000).

Full step-by-step guide: **[`docs/deployment/docker.md`](docs/deployment/docker.md)**.

#### 3. Self-host with Helm on Kubernetes

For production deployments — autoscaling, ingress, TLS, secret projection — use the umbrella Helm chart:

```bash
helm install featbit-rda charts/featbit-rda \
  --namespace featbit --create-namespace \
  -f charts/featbit-rda/examples/aks/values.yaml
```

Full guide and AKS reference values: **[`docs/deployment/helm.md`](docs/deployment/helm.md)**.

### Usage

Once the dashboard is up:

1. **Create an experiment** — pick a flag, write the hypothesis, define the primary metric and guardrails.
2. **Roll out the flag** in FeatBit; your application emits `flag_evaluation` and `metric_event` records to your data backend.
3. **Analyse** — click *Analyze* on the run. The web service pulls per-variant statistics, runs Bayesian A/B (or Thompson-sampling bandit) in-process, and stores the result on the run row.
4. **Decide** — the *evidence-analysis* phase frames the outcome as CONTINUE / PAUSE / ROLLBACK CANDIDATE / INCONCLUSIVE.
5. **Learn** — capture a structured postmortem; the next iteration starts from evidence, not memory.

Detailed workflow + data-source modes: **[`docs/usage/`](docs/usage/)**.

---

## Architecture

```
                ┌──────────────────────────────────────────────┐
                │  modules/web  (Next.js + Prisma)  :3000      │
                │  Dashboard, REST API, Bayesian/Bandit        │
                │  analysis engine                             │
                └──┬───────────────┬───────────────────┬───────┘
                   │               │                   │
       ┌───────────┘               │                   └────────────┐
       ▼                           ▼                                ▼
┌────────────────┐        ┌──────────────────┐          ┌────────────────────┐
│  External      │        │  modules/        │          │  modules/          │
│  PostgreSQL    │        │  track-service   │          │  experimentation-  │
│                │        │  (.NET)  :5050   │          │  claude-code-      │
│  experiments,  │        │                  │          │  connector         │
│  runs, memory, │        │  Optional —      │          │  (npm, runs on     │
│  activity log  │        │  bring your own  │          │  user's machine)   │
└────────────────┘        │  warehouse via   │          │  :3100 loopback    │
                          │  Customer        │          └────────────────────┘
                          │  Managed         │                    ▲
                          │  Endpoint        │                    │
                          └────────┬─────────┘          ┌─────────┴────────┐
                                   ▼                    │  skills/         │
                          ┌──────────────────┐          │  (release-       │
                          │  External        │          │  decision        │
                          │  ClickHouse      │          │  workflow        │
                          │                  │          │  CF-01 → CF-08)  │
                          │  Optional —      │          └──────────────────┘
                          │  flag_evaluations│
                          │  + metric_events │
                          └──────────────────┘
```

| Component | Stack | Role |
|---|---|---|
| **`skills/`** | Markdown skill catalog | Encodes the eight release-decision phases (CF-01 intent → CF-08 learning). Loaded by the coding agent at runtime; the agent calls the web API to persist state. |
| **`modules/web`** | Next.js, Prisma, TypeScript | Dashboard UI, REST API, in-process Bayesian / Thompson-sampling analysis engine, per-project memory store. |
| **`modules/experimentation-claude-code-connector`** | Node.js, `@anthropic-ai/claude-agent-sdk`, Express SSE | Optional npm package the user runs on their own machine to expose their local Claude Code CLI to the web UI's *Local Claude Code* chat mode. Published on npm; source in this repo. |
| **`modules/track-service`** *(optional)* | .NET, ClickHouse | Event ingest (`/api/track`) and per-experiment metric query (`/api/query/experiment`). Skip this entirely if you bring your own data warehouse via the Customer Managed Endpoint mode. |
| **External PostgreSQL** | — | Holds `Experiment`, `ExperimentRun`, `Activity`, `Message`, project + user memory. Provisioned by you; the chart and compose stack do not include a Postgres container. |
| **External ClickHouse** *(optional)* | — | Holds `flag_evaluations` and `metric_events`. Required only when `track-service` is in the loop; not needed in Customer Managed Endpoint mode. |

### Why track-service and ClickHouse are optional

Every experiment carries a `dataSourceMode`. The default (`featbit-managed`) pulls statistics from `track-service` via `/api/query/experiment`. The alternative (`customer-single` / `customer-per-metric`) calls **your own HTTPS endpoint** that returns per-variant statistics in a fixed shape — implemented in `modules/web/src/lib/stats/customer-endpoint-client.ts` and `customer-endpoint-fetcher.ts`. In customer mode the analysis engine never touches `track-service`, so neither it nor ClickHouse is required.

---

## Further reading

- **[`AGENTS.md`](AGENTS.md)** — full service map, environment variables, troubleshooting, and the canonical metric storage contract.
- **[`WHITE_PAPER.md`](WHITE_PAPER.md)** — product thesis and market positioning.
- **[`docs/deployment/docker.md`](docs/deployment/docker.md)** — Docker Compose deployment, end to end.
- **[`docs/deployment/helm.md`](docs/deployment/helm.md)** — Helm chart deployment.
- **[`docs/usage/`](docs/usage/)** — usage docs (placeholder until the docs site is published).
- **[`charts/README.md`](charts/README.md)** — Helm chart layout, design decisions, AKS examples.
- **[`skills/featbit-release-decision/`](skills/featbit-release-decision/)** — the release-decision workflow + CF-01 → CF-08 phase definitions.
- **[`modules/experimentation-claude-code-connector/README.md`](modules/experimentation-claude-code-connector/README.md)** — Local-mode bridge: install, config, SSE contract, publishing.
- **[`tutorial/`](tutorial/)** — Bayesian and experimentation learning notes (EN / 中文).

---

**License**: Apache 2.0 — see [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE). Forks and Derivative Works must retain the attribution to FeatBit Experimentation per Section 4(d) of the License.
