# Supported Recipes

The `release-decision` skill supports two recipes. The planner selects exactly one per run — never both.

## website_conversion_change

**Use for:** Homepage changes, CTA updates, onboarding page iterations, pricing page messaging, conversion-focused landing page A/B tests.

### Metric Pack

| Role | Metric | Description |
|---|---|---|
| Primary | `task_success_rate` | Rate of successful conversion events per session |
| Guardrail | `avg_cost` | Average cost per conversion event (must not regress) |
| Guardrail | `p95_latency_ms` | 95th percentile page or interaction latency (must stay below threshold) |

### Required Schema Columns

The selected table must have these columns (or a `column_mappings` alias):

| Column | Type | Description |
|---|---|---|
| `decision_key` | string | Identifies the experiment or flag key |
| `variant` | string | Variant label — typically `baseline` or `candidate` |
| `task_id` | string | Session or conversion event identifier (randomization unit) |
| `success` | boolean / int | Whether the conversion event succeeded |
| `cost` | numeric | Cost value for this event (can be 0 for non-cost scenarios) |
| `latency_ms` | numeric | Latency of the event in milliseconds |
| `created_at` | timestamp | Event timestamp |

### Default Plan Values

```json
{
  "recipe_id": "website_conversion_change",
  "primary_metric": "task_success_rate",
  "guardrails": ["avg_cost", "p95_latency_ms"],
  "randomization_unit": "task_id",
  "rollout_percentage": 10,
  "data_source_kind": "postgres"
}
```

---

## agent_variant_comparison

**Use for:** Coding agent planner variants, prompt version comparisons, workflow version comparisons, agent release guardrail checks.

### Metric Pack

| Role | Metric | Description |
|---|---|---|
| Primary | `task_success_rate` | Rate of tasks completed successfully by the agent |
| Guardrail | `avg_cost` | Average cost per task — typically token cost or infrastructure cost |
| Guardrail | `p95_latency_ms` | 95th percentile task completion latency |

### Required Schema Columns

Same as `website_conversion_change`:

| Column | Type | Description |
|---|---|---|
| `decision_key` | string | Identifies the agent variant experiment |
| `variant` | string | Variant label — e.g., `baseline`, `candidate` |
| `task_id` | string | Task identifier (randomization unit) |
| `success` | boolean / int | Whether the task completed successfully |
| `cost` | numeric | Token or compute cost for this task |
| `latency_ms` | numeric | Task completion time in milliseconds |
| `created_at` | timestamp | Task completion timestamp |

### Default Plan Values

```json
{
  "recipe_id": "agent_variant_comparison",
  "primary_metric": "task_success_rate",
  "guardrails": ["avg_cost", "p95_latency_ms"],
  "randomization_unit": "task_id",
  "rollout_percentage": 10,
  "data_source_kind": "postgres"
}
```

---

## How the Planner Selects a Recipe

1. If the user is evaluating a website, landing page, or UI change → `website_conversion_change`
2. If the user is comparing agent prompts, planner versions, or workflow variants → `agent_variant_comparison`
3. If the scenario is ambiguous, ask one clarifying question: "Is this a UI/page change or an agent/AI model comparison?"

The planner should never invent a third recipe.
