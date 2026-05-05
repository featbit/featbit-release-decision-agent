# Usage

> A standalone documentation site is not yet published. This folder is the placeholder for end-user usage docs; until it grows, the in-product onboarding inside the web dashboard is the authoritative guide.

## The release-decision loop

Every experiment moves through the same eight phases (CF-01 → CF-08). The web UI walks you through them; the same phases are encoded as Skills under [`skills/`](../../skills/) so the coding agent can drive them too.

```
intent → hypothesis → exposure → measurement → analysis → decision → learning
```

| Phase | What you do | Where |
|---|---|---|
| **CF-01 Intent** | Turn a vague goal into a measurable outcome | UI: experiment Setup tab |
| **CF-02 Hypothesis** | Write a falsifiable claim ("if we do X, metric Y will move by Z") | UI: experiment Setup tab |
| **CF-03 / CF-04 Exposure** | Decide who sees what — feature flag + rollout | FeatBit feature flag (managed in [FeatBit](https://featbit.co)) |
| **CF-05 Measurement** | Pick the primary metric + guardrails, instrument the events | UI: experiment Setup tab + your application code |
| **CF-06 Analysis** | Run Bayesian A/B (or Thompson-sampling bandit) over collected data | UI: experiment Run tab → **Analyze** |
| **CF-07 Decision** | Frame the result as CONTINUE / PAUSE / ROLLBACK CANDIDATE / INCONCLUSIVE | UI + activity log |
| **CF-08 Learning** | Capture a structured postmortem so the next iteration starts from evidence | UI: experiment Learning tab |

## Choosing a data source

When you create an experiment in **Expert Setup**, the Data Source step lets you pick how analysis pulls per-variant statistics:

| Mode | What it does |
|---|---|
| **FeatBit Managed** *(default)* | Auto-pull from the bundled `track-service` (ClickHouse-backed). Easiest path. |
| **Customer Managed Endpoint — single** | Call your own HTTPS endpoint that returns experiment statistics on demand. Use this when you already have a data warehouse and don't want to ingest events twice. |
| **Customer Managed Endpoint — per-metric** | Same as above, but route different metrics to different endpoints. |
| **Paste manually** | Type per-variant totals directly in the Primary metric / Guardrails steps. |
| **External / other** | Free-text note. No live fetch — record only. |

The Customer Managed Endpoint contract (request / response shape, auth, retries) is implemented in [`modules/web/src/lib/stats/customer-endpoint-client.ts`](../../modules/web/src/lib/stats/customer-endpoint-client.ts).

## Two chat modes

Inside an experiment, the chat panel can drive a coding agent through the workflow. Toggle persists per-browser:

- **Managed** *(default)* — web proxies to FeatBit's hosted Managed Agents. No client-side install.
- **Local Claude Code** — run `npx @featbit/experimentation-claude-code-connector` on your own machine; the chat panel connects to it on `127.0.0.1:3100` and uses your local Claude Code CLI.

## API contracts

For programmatic access — analyse a run, list running experiments, query per-variant statistics — the canonical contracts are documented in [`AGENTS.md`](../../AGENTS.md) under "Key API contracts".

---

> Found a gap? Open an issue or PR — this folder is intentionally a stub waiting for production usage docs.
