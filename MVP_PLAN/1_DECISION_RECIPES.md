# FeatBit Release Decision Recipes

## Purpose

This file defines the supported decision recipes for the MVP.

Each recipe tells the system:

1. when the recipe applies
2. what user intent it supports
3. what the user must provide
4. what the system must generate automatically
5. what metrics and guardrails are used
6. what rollout default is used
7. how the reviewer summary should be framed

These recipes are the source of truth for Step 1 of the MVP plan.

## Recipe Selection Rule

The user does not choose metrics.

The user provides a goal and boundaries.

The agent selects one supported recipe.

The selected recipe determines:

1. primary metric
2. guardrails
3. rollout default
4. summary framing
5. validation rules specific to the recipe

## MVP Recipes

The MVP supports exactly these recipes:

1. `agent_variant_comparison`
2. `website_conversion_change`

No other recipe is in scope for the first MVP.

## Recipe 1: agent_variant_comparison

### Use When

Use this recipe when the user wants to compare two agent, model, planner, workflow, or implementation variants in a task-driven environment.

Typical user requests:

1. compare planner_a and planner_b
2. compare two coding-agent strategies
3. test a new agent behavior before wider rollout
4. evaluate whether a candidate variant should receive more traffic

### User Must Provide

1. decision target or decision key context
2. baseline variant name
3. candidate variant name
4. what outcome they want improved
5. major boundary or risk concern if any

### System Must Generate

1. recipe id: `agent_variant_comparison`
2. primary metric: `task_success_rate`
3. guardrails:
   `avg_cost`
   `p95_latency_ms`
4. default rollout percentage: `10`
5. current data source kind: `postgres`
6. table resolved from inspected customer schema or mapping
7. randomization unit: `task_id`
8. reviewer summary framing for agent performance decisions

### Metric Pack

Primary metric:

1. `task_success_rate`

Guardrails:

1. `avg_cost`
2. `p95_latency_ms`

### Decision Policy

Recommendation rules:

1. primary metric improves and no guardrail fails -> `continue`
2. any guardrail fails -> `pause`
3. primary metric clearly worsens -> `rollback_candidate`
4. otherwise -> `inconclusive`

Rollout guidance:

1. `continue` -> `25`
2. `pause` -> current rollout
3. `rollback_candidate` -> `0`
4. `inconclusive` -> current rollout

### Data Assumptions

Required fields in the approved event model:

1. `decision_key`
2. `variant`
3. `task_id`
4. `success`
5. `cost`
6. `latency_ms`
7. `created_at`

### Reviewer Summary Framing

The summary must explain:

1. whether the candidate variant performed better on task success
2. whether cost and latency remained within acceptable bounds
3. what rollout action is recommended next
4. that the result is a deterministic operational recommendation, not a formal statistical conclusion

### Out Of Scope For This Recipe

1. more than two variants
2. custom metrics chosen by the user
3. arbitrary SQL or ad hoc analysis
4. generalized experiment interpretation

## Recipe 2: website_conversion_change

### Use When

Use this recipe when the user wants to evaluate a website change intended to improve conversion for one audience without materially harming another audience or existing navigation behavior.

Typical user requests:

1. improve demo conversion on the homepage
2. help a target customer segment see the right message faster
3. improve new visitor conversion without hurting existing docs users
4. compare current homepage messaging with a candidate variant

### User Must Provide

1. page or flow scope
2. target audience or audience to help
3. desired business outcome
4. audience or behavior that must not be harmed
5. baseline variant name
6. candidate variant name

### System Must Generate

1. recipe id: `website_conversion_change`
2. primary metric: `task_success_rate`
3. guardrails:
   `avg_cost`
   `p95_latency_ms`
4. default rollout percentage: `10`
5. current data source kind: `postgres`
6. table resolved from inspected customer schema or mapping
7. randomization unit: `task_id`
8. reviewer summary framing for audience-specific website changes

### MVP Constraint For This Recipe

The first MVP does not introduce a separate website analytics metric system.

To keep the runtime small, this recipe uses the same approved metric surface as the MVP runtime:

1. `task_success_rate` as the primary outcome proxy
2. `avg_cost` as an efficiency guardrail
3. `p95_latency_ms` as a responsiveness guardrail

This recipe exists to prove the decision workflow shape for website changes, not to deliver a complete web experimentation model in the first release.

### Metric Pack

Primary metric:

1. `task_success_rate`

Guardrails:

1. `avg_cost`
2. `p95_latency_ms`

### Decision Policy

Recommendation rules:

1. primary metric improves and no guardrail fails -> `continue`
2. any guardrail fails -> `pause`
3. primary metric clearly worsens -> `rollback_candidate`
4. otherwise -> `inconclusive`

Rollout guidance:

1. `continue` -> `25`
2. `pause` -> current rollout
3. `rollback_candidate` -> `0`
4. `inconclusive` -> current rollout

### Data Assumptions

Required fields in the approved event model:

1. `decision_key`
2. `variant`
3. `task_id`
4. `success`
5. `cost`
6. `latency_ms`
7. `created_at`

### Reviewer Summary Framing

The summary must explain:

1. whether the candidate experience improved the target outcome
2. whether the protected behavior showed signs of unacceptable regression
3. what rollout action is recommended next
4. that the result is a deterministic operational recommendation, not a formal statistical conclusion

### Out Of Scope For This Recipe

1. free-form website KPIs in the first MVP
2. multi-page attribution logic
3. segment-specific analytics pipelines
4. custom event models outside the approved schema surface

## Shared Validation Rules

These rules apply to all MVP recipes:

1. exactly two variants
2. `data_source_kind` must currently be `postgres`
3. approved table only
4. approved metrics only
5. randomization unit must be `task_id`
6. time range is required

## Implementation Consequences

The runtime and prompts should follow these consequences:

1. recipe selection happens before plan generation
2. plan generation is recipe-driven, not free-form
3. validator enforces recipe-defined metrics and guardrails
4. reviewer summary wording depends on recipe type
5. adding future support should happen by adding a new recipe, not by making metrics user-configurable
