# FeatBit Release Decision Agent

A **release decision plugin/toolkit** for AI coding agents (GitHub Copilot, Claude Code, Cursor, and others). An agent takes a user brief, connects to the user's own PostgreSQL data, and returns a deterministic, auditable recommendation: `continue`, `pause`, `rollback_candidate`, or `inconclusive`.

## Goal

> A PM or engineer describes a release decision goal. A coding agent maps that goal to a supported recipe, generates a measurement plan, runs approved queries against the customer's own database, and produces a recommendation that is safe to review and act on.

No credentials leave the user's environment. No LLM generates SQL. Metric selection is automatic — the user never picks metrics.

## What This Repo Contains

| Path | Purpose |
|---|---|
| `skills/release-decision/` | Agent skill — orchestrates the full workflow inside a coding agent session |
| `src/FeatBit.ReleaseDecision.Cli/` | `featbit-decision` CLI — measurement, validation, and recommendation kernel |
| `examples/` | Sample briefs and demo script |

The agent skill and CLI communicate only through local files (`plan.json`, `catalog.json`, `results.json`, `summary.md`, `featbit-actions.json`). No network calls between them.

## How It Works

```
featbit-decision inspect        --connection-env <ENV_VAR> --out artifacts/catalog.json
featbit-decision validate-plan  --plan artifacts/plan.json --catalog artifacts/catalog.json
featbit-decision run            --plan artifacts/plan.json --catalog artifacts/catalog.json \
                                --connection-env <ENV_VAR> --out artifacts/results.json \
                                --summary-out artifacts/summary.md
featbit-decision sync-dry-run   --plan artifacts/plan.json --out artifacts/featbit-actions.json
```

## MVP — What Is Implemented

### Recipes

| Recipe | Use For | Primary Metric | Guardrails |
|---|---|---|---|
| `agent_variant_comparison` | Coding agents, prompt variants, workflow versions | `task_success_rate` | `avg_cost`, `p95_latency_ms` |
| `website_conversion_change` | Homepage, CTA, onboarding, conversion pages | `task_success_rate` | `avg_cost`, `p95_latency_ms` |

### CLI Commands

| Command | What It Does |
|---|---|
| `inspect` | Queries `information_schema`, writes `catalog.json` with metric-candidate tables |
| `validate-plan` | Validates recipe, variants, columns, time range against catalog |
| `run` | Executes approved parameterized SQL, computes per-variant metrics, writes `results.json` and `summary.md` |
| `sync-dry-run` | Derives `featbit-actions.json` (flag + variant + rollout) from plan — no DB connection needed |

### Decision Policy

| Condition | Recommendation | Rollout Action |
|---|---|---|
| Guardrail regression > 10% relative | `pause` | Hold |
| Primary metric < −5% relative | `rollback_candidate` | Hold |
| Primary metric improved | `continue` | Advance: 10 → 25 → 50 → 75 → 100% |
| Otherwise | `inconclusive` | Hold |

### Key Design Constraints

1. Connection strings are passed via environment variable name — never embedded in files.
2. Metric selection is recipe-driven — the agent never asks the user to choose metrics.
3. All FeatBit control actions are dry-run by default (`featbit-actions.json` for operator review).
4. Evaluation is deterministic and rule-based — no formal statistical significance claimed.
5. `decision_key` is always applied as a filter — experiments sharing a table are isolated.

## MVP — Out of Scope

- Statistical experimentation engine (p-values, confidence intervals)
- Arbitrary user-defined metrics or LLM-generated SQL
- Prebuilt adapters beyond PostgreSQL
- Web UI
- Auto-rollback automation
