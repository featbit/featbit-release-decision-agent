---
name: release-decision
description: Guides agents through FeatBit release decision workflows. Use when a user needs a data-driven recommendation on whether to continue, pause, or roll back a feature flag rollout. Resolves both website or landing-page changes and agent or prompt variant comparisons into a reviewer-ready recommendation card. Triggers — "release decision", "should I continue rollout", "analyze experiment results", "feature flag results", "is my experiment ready", "agent variant comparison", "website conversion decision", "rollout recommendation", "continue or rollback", "evaluate my experiment".
license: MIT
metadata:
  author: FeatBit
  version: 1.0.0
  category: release-management
---

# FeatBit Release Decision

Deterministic, data-driven release decisions on FeatBit feature flags. Use when a user needs to decide whether a flagged rollout should continue, pause, or become a rollback candidate.

## When to Use

Activate when users:

- Ask whether to continue or roll back a feature flag rollout
- Need a recommendation based on experiment or observational data
- Are comparing two agent prompt variants for quality or cost metrics
- Are evaluating a website or landing-page change against conversion goals
- Say things like "should I continue rollout", "is my experiment ready", "analyze my feature flag results"

Do not use for flag CRUD operations — use the FeatBit REST API skill for those.

## Supported Recipes

| Recipe | Use For |
|---|---|
| `website_conversion_change` | Homepage, CTA, onboarding, pricing, or conversion-focused page changes |
| `agent_variant_comparison` | Coding agents, prompt variants, planner versions, workflow version comparisons |

Full recipe reference: [references/recipes.md](references/recipes.md)

## Required Inputs

Collect these from the user before running any commands. Ask only for what is missing — do not request technical metric names.

| Input | Description | Example |
|---|---|---|
| What changed | Which feature flag or change is being evaluated | `"new checkout agent v2"`, `"homepage hero CTA"` |
| Goal | Business or operational objective | `"increase checkout completions"`, `"reduce task cost"` |
| Data source env var | Name of the environment variable holding the Postgres connection string | `FB_DECISION_PG` |
| Variant names | Two variant identifiers | `baseline`, `candidate` |
| Protected audience _(optional)_ | Groups to exclude from rollout actions | `"premium users"` |

**Do not ask the user to select metrics.** The recipe selects them automatically from its defaults.

## Execution Workflow

Run these steps in order. Do not skip or reorder steps. Full rules: [references/workflow.md](references/workflow.md)

### Step 1 — Inspect the data source

```bash
featbit-decision inspect --connection-env <ENV_VAR> --out artifacts/catalog.json
```

Produces `catalog.json`. Read it to understand the available tables and their columns.

### Step 2 — Generate plan.json

Use the planner system prompt with the user brief and `catalog.json` as inputs. The planner:

- Picks exactly one supported recipe
- Maps the user goal to the recipe's metric defaults
- Selects a table that satisfies the required columns (or fails with an explanation)

Output: `plan.json`. Do not generate SQL or invent metrics.

### Step 3 — Validate the plan

```bash
featbit-decision validate-plan --plan artifacts/plan.json --catalog artifacts/catalog.json
```

Stop and explain any validation error to the user. Do not proceed past a failure.

### Step 4 — Run evaluation

```bash
featbit-decision run \
  --plan artifacts/plan.json \
  --catalog artifacts/catalog.json \
  --connection-env <ENV_VAR> \
  --out artifacts/results.json \
  --summary-out artifacts/summary.md
```

Produces `results.json` (machine-readable recommendation) and `summary.md` (human-readable explanation).

### Step 5 — Apply control policy

Determine whether direct FeatBit control is authorized in the environment, or whether an action file should be generated for operator review.

**Default path — dry-run (always safe):**

```bash
featbit-decision sync-dry-run --plan artifacts/plan.json --out artifacts/featbit-actions.json
```

Produces `featbit-actions.json` for operator or automation review.

**Direct execution path:** Use only when FeatBit management tooling is already present and explicitly authorized in the session.

### Step 6 — Present the recommendation card

Format the final output using the card structure in [references/output-format.md](references/output-format.md).

## Key Rules

1. **Do not expose intermediate artifacts** (`catalog.json`, `plan.json`, `results.json`) unless the user asks for debugging.
2. **Do not claim statistical significance.** Use reviewer language: "directionally positive", "within guardrail bounds", "meets exit criteria".
3. **Do not skip `validate-plan`.** Treat CLI output as authoritative — do not substitute informal reasoning.
4. **Do not ask the user to choose metrics.** Recipe defaults are the source of truth.
5. **Never put credentials in any artifact.** Always pass connection strings by environment variable name only.

## CLI Command Reference

Full command options and examples: [references/commands.md](references/commands.md)
