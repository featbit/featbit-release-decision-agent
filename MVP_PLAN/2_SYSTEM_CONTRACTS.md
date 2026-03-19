# FeatBit Release Decision System Contracts

## Purpose

This file defines the Step 2 contracts that the runtime, prompts, scripts, and examples must follow.

The goal is to make artifacts stable, machine-readable, and recipe-driven.

## Contract Rules

1. All contracts are recipe-driven.
2. `plan.json` is system-generated.
3. All artifact fields must be explicit.
4. The first MVP uses a data source adapter abstraction.
5. PostgreSQL is the current minimal supported adapter.
6. The first MVP supports exactly two variants.
7. Raw database credentials must not appear in artifacts.

## 1. plan.json

### Purpose

Represents the system-generated execution plan for one decision run.

### Required Fields

1. `recipe_id`
2. `decision_key`
3. `variants`
4. `randomization_unit`
5. `primary_metric`
6. `guardrails`
7. `rollout_percentage`
8. `data_source_kind`
9. `table`
10. `time_range.start`
11. `time_range.end`

### Optional Fields

1. `notes`
2. `user_goal`
3. `boundaries`
4. `page_scope`
5. `target_audience`
6. `protected_audience`
7. `column_mappings`

### Credential Handling

1. `plan.json` must not contain a connection string, username, password, token, or secret reference value.
2. Database access should be provided at runtime through `--connection-env` or another trusted execution-side mechanism.
3. Raw credentials are not part of the artifact contract.

### Validation Rules

1. `recipe_id` must be a supported recipe
2. `variants` must contain exactly two entries
3. `randomization_unit` must be `task_id`
4. `primary_metric` must match the selected recipe
5. `guardrails` must match the selected recipe
6. `data_source_kind` must currently be `postgres`
7. `table` must be present in the inspected catalog or provided through a mapping rule
8. `column_mappings`, when present, must map canonical recipe field names to actual columns in the selected table
9. `time_range` must be present

## 2. featbit-actions.json

### Purpose

Represents the control-plane intent derived from a validated plan.

### Required Fields

1. `decision_key`
2. `actions`

### Required Actions

1. `ensure_flag`
2. `ensure_variants`
3. `set_rollout`

### Validation Rules

1. actions must be derivable from `plan.json`
2. `ensure_variants` must include exactly the plan variants
3. `set_rollout` must match the plan rollout percentage

## 3. catalog.json

### Purpose

Represents the inspected customer data source schema available to the runtime.

### Required Fields

1. `data_source_kind`
2. `tables`
3. `metric_candidates`

### Required Table Data

1. `name`
2. `columns`

### Required Column Data

1. `name`
2. `type`

### Validation Rules

1. `data_source_kind` must currently be `postgres`
2. required table must exist
3. required columns for the recipe must exist directly or be satisfiable through `column_mappings`

## 4. results.json

### Purpose

Represents the machine-readable evaluation output for one decision run.

### Required Fields

1. `recipe_id`
2. `decision_key`
3. `primary_metric`
4. `guardrails`
5. `recommendation`
6. `recommended_next_rollout_percentage`
7. `reasoning`

### Primary Metric Object

Must contain:

1. `name`
2. `baseline_variant`
3. `candidate_variant`
4. `baseline_value`
5. `candidate_value`
6. `absolute_delta`
7. `relative_delta`

### Guardrail Object

Must contain:

1. `name`
2. `baseline_value`
3. `candidate_value`
4. `relative_delta`
5. `status`

### Recommendation Rules

`recommendation` must be one of:

1. `continue`
2. `pause`
3. `rollback_candidate`
4. `inconclusive`

## 5. summary.md

### Purpose

Represents the reviewer-facing operational summary.

### Must Answer

1. what the system recommends
2. why it recommends it
3. what risks were checked
4. what next rollout action is suggested

### Required Constraints

1. language must be short and operational
2. do not claim formal statistical significance
3. wording must reflect the selected recipe

## Sample Artifact Requirements

Step 2 should include sample artifacts for both recipes.

Minimum sample set:

1. one sample `plan.json` for `agent_variant_comparison`
2. one sample `plan.json` for `website_conversion_change`
3. one sample `featbit-actions.json`
4. one sample `results.json`
5. one sample `summary.md`

## Implementation Consequences

1. validator logic should bind directly to these contracts
2. prompt outputs should target these contracts exactly
3. runtime serialization should follow these field names without drift
4. sample artifacts should be added next under examples or a dedicated sample location
