# FeatBit Release Decision Plugin
## Production-Ready MVP Spec v0.3

---

## 1. Product Thesis

FeatBit should not build another standalone coding agent.

FeatBit should build a **release decision plugin/toolkit for existing coding agents**.

The product exists to help agents such as Claude Code, GitHub Copilot, Cursor, or other agentic coding environments do three things reliably:

- plan a release decision from decision inputs
- execute release-control actions through existing FeatBit capabilities
- evaluate system signals and human context and return a deterministic recommendation without exposing unnecessary raw data outside the user's environment

This MVP is intended to be deployable in a production environment with a narrow, auditable scope.

Terminology in this spec is standardized as follows:

- `decision inputs`: briefs, pull requests, tickets, and other inputs that initiate a decision
- `system signals`: metrics, measurement data, alerts, logs, and other observable system outputs
- `human context`: market changes, company decisions, strategic priorities, and other human-supplied real-world context

---

## 2. Product Definition

The product name for this phase is:

**FeatBit Release Decision Plugin**

The repository may keep the existing project name, but the runtime shape of the MVP is not a standalone agent runtime.

It is a plugin/tooling layer composed of:

- existing coding agents for orchestration
- existing FeatBit control-plane tooling for flag and rollout operations
- a new `featbit-decision` runtime for measurement, validation, and recommendation

This product must extend the value of FeatBit's existing feature flag infrastructure, not compete with or replace it.

The commercial logic of the MVP is:

- feature flag infrastructure remains the core production system and monetizable control plane
- the release decision plugin increases the value, stickiness, and operational reach of that infrastructure
- decisioning is an expansion layer on top of feature flag infrastructure, not a separate product thesis that ignores FeatBit's current business

---

## 3. Core Goal

The production-ready MVP must prove one closed loop:

> A PM or engineer can describe a release decision through decision inputs, a coding agent can turn that input into a valid decision plan, reuse existing FeatBit tooling to apply or prepare rollout actions, evaluate private system signals together with human context, and produce a recommendation that is safe to review and act on for experiment rollout, safe release, or rapid rollback.

Success means the workflow is usable in a real engineering environment with clear boundaries, deterministic behavior, and minimal sensitive data exposure.

---

## 4. Product Boundary

This product must not drift into becoming a general experimentation platform.

Traditional experimentation platforms such as GrowthBook are designed to manage a broad experimentation lifecycle inside a product platform. Their center of gravity is typically:

- experiment configuration inside the platform
- reusable metric systems and fact-table modeling
- broad statistical analysis and slicing
- experiment results consumption through the platform UI

FeatBit Release Decision Plugin has a different center of gravity.

Its primary job is to help a coding agent make an operational release decision by connecting:

- repo and code context
- decision inputs
- existing FeatBit release-control primitives
- system signals in the customer's environment
- human context
- deterministic release recommendation logic

The product therefore optimizes for:

- agent-native workflow instead of platform-native workflow
- release decisioning instead of general experimentation analytics
- private-environment execution instead of broad central analysis surfaces
- auditable operational artifacts instead of rich in-product analytics as the primary output

If a future feature increases general experimentation breadth but does not improve agent-driven release decision quality, safety, or operational usefulness, it is out of scope for this product.

---

## 5. Production-Ready MVP Scope

This MVP includes only the minimum surface needed for production use in a narrow scenario.

### 5.1 Included

- a coding-agent workflow for converting a brief into `plan.json`
- reuse of FeatBit CLI, MCP, Skills, or SDK for release-control actions
- a production-safe `featbit-decision` command surface
- fixed metric templates for approved decision metrics
- deterministic recommendation logic
- machine-readable artifacts for audit and automation
- a local/private data-plane execution model
- dry-run behavior when direct control-plane execution is unavailable

### 5.2 Excluded

- standalone agent runtime
- web UI
- arbitrary SQL generation
- generalized analytics platform
- multiple warehouse engines in the first production MVP
- statistical experimentation engine
- auto-rollback automation
- duplicated feature-flag CRUD logic inside the decision runtime

---

## 6. Target User Experience

### User Brief

> Compare planner_a and planner_b for coding-agent tasks.  
> Primary metric: task_success_rate.  
> Guardrails: avg_cost, p95_latency_ms.  
> Start with 10% rollout.  
> Decision key: coding_agent_planner.

### Expected Workflow

1. The coding agent reads the brief.
2. The coding agent writes `plan.json`.
3. The coding agent writes `featbit-actions.json`.
4. The coding agent uses existing FeatBit tools to ensure the decision flag and variants exist.
5. The coding agent applies the requested rollout when direct FeatBit access is available.
6. The coding agent runs `featbit-decision inspect` if catalog metadata is missing or stale.
7. The coding agent runs `featbit-decision validate-plan`.
8. The coding agent runs `featbit-decision run`.
9. The coding agent writes `results.json` and `summary.md`.
10. The coding agent suggests one next action: `continue`, `pause`, `rollback_candidate`, or `inconclusive`.

---

## 7. Architecture

```text
User brief
  -> Coding agent
      -> generate plan.json
      -> generate featbit-actions.json
      -> execute FeatBit control actions through existing tooling when available
      -> call featbit-decision inspect
      -> call featbit-decision validate-plan
      -> call featbit-decision run
      -> read results.json
      -> generate summary.md
      -> propose next rollout action
```

### 7.1 Responsibility Split

#### Orchestration Layer
Handled by coding agents.

Responsibilities:

- interpret natural language brief
- read repo context
- produce structured artifacts
- choose tool calls
- present summary to the user

#### Control Plane
Handled by existing FeatBit tools.

Responsibilities:

- ensure flag exists
- ensure variants exist
- update rollout percentage
- update supported metadata when available

Execution path preference:

1. FeatBit MCP / Skills
2. FeatBit CLI
3. FeatBit SDK
4. dry-run artifact only

#### Measurement Plane
Handled by `featbit-decision`.

Responsibilities:

- inspect supported schema
- validate plans against supported contracts
- execute fixed metric templates
- compute deterministic recommendation
- emit structured outputs

---

## 8. Trust Boundary and Data Residency

This section is mandatory for the production-ready MVP.

### 8.1 Data Handling Principle

Except for the minimum FeatBit control-plane data required for feature flag operations, decision data must remain in the user's environment.

### 8.2 Allowed to Leave the User Environment

- FeatBit control-plane requests already required for flag and rollout operations
- machine-readable artifacts intentionally produced by the workflow
- aggregated decision outputs such as metric values, recommendation, and summary

### 8.3 Must Stay in the User Environment

- raw event-level warehouse data
- arbitrary codebase telemetry not required for control-plane actions
- internal warehouse credentials
- unrestricted SQL execution logic generated by the LLM

### 8.4 Product Rule

The LLM may reason over plans, catalogs, and aggregated results.
The LLM must not generate executable SQL.
The measurement runtime executes only approved templates packaged in the repository.

---

## 9. Existing FeatBit Tooling Policy

### 9.1 Hard Rule

If FeatBit already supports a capability through CLI, MCP, Skills, or SDK, the plugin must reuse that capability.

### 9.2 Do Not Rebuild Feature Flag Control

The new runtime must not implement new feature-flag CRUD or rollout logic when that behavior already exists in FeatBit tooling.

### 9.3 Minimum Required Control-Plane Operations

The MVP requires only these control-plane operations:

- ensure the decision flag exists
- ensure exactly two variants exist
- set initial rollout percentage
- optionally attach supported metadata such as description, notes, or tag

### 9.4 Fallback Behavior

If direct FeatBit invocation is unavailable, the workflow must still produce `featbit-actions.json` and continue with measurement and recommendation.

The MVP must not fail only because direct control-plane execution is unavailable.

---

## 10. Supported Decision Model

### 10.1 Initial Warehouse Support

Only ClickHouse is in scope for the first production-ready MVP.

### 10.2 Initial Table Assumption

The supported base table is `decision_events`.

```sql
CREATE TABLE decision_events
(
  decision_key String,
  variant String,
  task_id String,
  success UInt8,
  cost Float64,
  latency_ms UInt32,
  created_at DateTime
)
ENGINE = MergeTree
ORDER BY (decision_key, created_at, task_id);
```

### 10.3 Mapping Support

A simple mapping file may be supported for column aliasing.
Generalized schema inference is out of scope.

### 10.4 Supported Randomization Unit

Only `task_id` is supported in this MVP.

---

## 11. Supported Metrics

Only these three metrics are supported:

### `task_success_rate`

Definition:

- `sum(success) / countDistinct(task_id)`

Direction:

- higher is better

### `avg_cost`

Definition:

- `avg(cost)`

Direction:

- lower is better

### `p95_latency_ms`

Definition:

- `quantileExact(0.95)(latency_ms)`

Direction:

- lower is better

### SQL Rule

All SQL must come from fixed repository templates.
Coding agents must never generate executable SQL for the measurement runtime.

---

## 12. Deterministic Recommendation Engine

The recommendation engine is deterministic only.

### Guardrail Thresholds

- `avg_cost` regression greater than 5% is a failure
- `p95_latency_ms` regression greater than 10% is a failure

### Recommendation Rules

- if the primary metric improves and no guardrail fails, return `continue`
- if any guardrail fails, return `pause`
- if the primary metric worsens materially, return `rollback_candidate`
- otherwise return `inconclusive`

### Rollout Guidance

- `continue` => 25
- `pause` => current rollout
- `rollback_candidate` => 0
- `inconclusive` => current rollout

### Output Constraint

The recommendation is an operational suggestion, not a statistical conclusion.

---

## 13. Runtime Surface

The production runtime is named:

```bash
featbit-decision
```

It must remain small, scriptable, deterministic, and suitable for automation.

### 13.1 `inspect`

Purpose:
inspect the ClickHouse schema and write `catalog.json`

```bash
featbit-decision inspect --connection "$CLICKHOUSE_DSN" --out ./out/catalog.json
```

### 13.2 `validate-plan`

Purpose:
validate `plan.json` against supported fields and the catalog

```bash
featbit-decision validate-plan \
  --plan ./out/plan.json \
  --catalog ./out/catalog.json
```

Minimum validation rules:

- exactly two variants
- supported metrics only
- supported unit only: `task_id`
- table exists
- time range exists

### 13.3 `run`

Purpose:
run fixed metric templates and generate `results.json`

```bash
featbit-decision run \
  --plan ./out/plan.json \
  --catalog ./out/catalog.json \
  --connection "$CLICKHOUSE_DSN" \
  --out ./out/results.json
```

### 13.4 `sync-dry-run`

Purpose:
write a dry-run FeatBit control payload when direct FeatBit execution is unavailable

```bash
featbit-decision sync-dry-run \
  --plan ./out/plan.json \
  --out ./out/featbit-actions.json
```

---

## 14. Data Contracts

### 14.1 `plan.json`

```json
{
  "decision_key": "coding_agent_planner",
  "variants": ["planner_a", "planner_b"],
  "randomization_unit": "task_id",
  "primary_metric": "task_success_rate",
  "guardrails": ["avg_cost", "p95_latency_ms"],
  "rollout_percentage": 10,
  "warehouse": "clickhouse",
  "table": "decision_events",
  "time_range": {
    "start": "2026-03-01T00:00:00Z",
    "end": "2026-03-07T00:00:00Z"
  },
  "notes": "Compare planner strategies for coding-agent tasks."
}
```

### 14.2 `featbit-actions.json`

```json
{
  "decision_key": "coding_agent_planner",
  "actions": [
    {
      "type": "ensure_flag",
      "flag_kind": "multi_variant"
    },
    {
      "type": "ensure_variants",
      "variants": ["planner_a", "planner_b"]
    },
    {
      "type": "set_rollout",
      "percentage": 10
    }
  ]
}
```

### 14.3 `catalog.json`

```json
{
  "warehouse": "clickhouse",
  "tables": [
    {
      "name": "decision_events",
      "columns": [
        { "name": "decision_key", "type": "String" },
        { "name": "variant", "type": "String" },
        { "name": "task_id", "type": "String" },
        { "name": "success", "type": "UInt8" },
        { "name": "cost", "type": "Float64" },
        { "name": "latency_ms", "type": "UInt32" },
        { "name": "created_at", "type": "DateTime" }
      ]
    }
  ],
  "metric_candidates": [
    "task_success_rate",
    "avg_cost",
    "p95_latency_ms"
  ]
}
```

### 14.4 `results.json`

```json
{
  "decision_key": "coding_agent_planner",
  "primary_metric": {
    "name": "task_success_rate",
    "baseline_variant": "planner_a",
    "candidate_variant": "planner_b",
    "baseline_value": 0.61,
    "candidate_value": 0.648,
    "absolute_delta": 0.038,
    "relative_delta": 0.0623
  },
  "guardrails": [
    {
      "name": "avg_cost",
      "baseline_value": 0.42,
      "candidate_value": 0.429,
      "relative_delta": 0.0214,
      "status": "pass"
    },
    {
      "name": "p95_latency_ms",
      "baseline_value": 1800,
      "candidate_value": 1785,
      "relative_delta": -0.0083,
      "status": "pass"
    }
  ],
  "recommendation": "continue",
  "recommended_next_rollout_percentage": 25,
  "reasoning": [
    "Primary metric improved",
    "No guardrail regression detected"
  ]
}
```

### 14.5 `summary.md`

```md
# Release Decision Summary

Decision key: `coding_agent_planner`

## Result
`planner_b` improves task success rate by **6.2%** over `planner_a`.

## Guardrails
- avg_cost: pass (+2.1%)
- p95_latency_ms: pass (-0.8%)

## Recommendation
Continue rollout to **25%**.

## Note
This recommendation is based on rule-based metric comparison in the MVP and is not a formal statistical conclusion.
```

---

## 15. Prompt and Workflow Requirements

The repository must provide prompt and workflow documents that guide coding agents without replacing them.

### `planner-system.md`

Must instruct the agent to:

- return valid JSON only for `plan.json`
- use supported metrics only
- default warehouse to `clickhouse`
- default table to `decision_events`
- use `task_id` as the randomization unit
- write `featbit-actions.json` for control-plane intent

### `summary-system.md`

Must instruct the agent to:

- summarize results in concise business language
- avoid claiming statistical certainty
- include the rule-based output note

### `featbit-control-policy.md`

Must instruct the agent to:

- prefer existing FeatBit tools for flag CRUD and rollout
- never reimplement those operations in new code
- emit dry-run artifacts when direct execution is unavailable

### `claude-workflow.md` or equivalent agent workflow file

Must describe the standard operating sequence:

1. read `brief.md`
2. create `plan.json`
3. create `featbit-actions.json`
4. execute FeatBit control-plane actions when available
5. run `featbit-decision inspect`
6. run `featbit-decision validate-plan`
7. run `featbit-decision run`
8. generate `summary.md`

---

## 16. Repository Shape

```text
/featbit-release-decision-agent
  /src
    /DecisionCli
      Program.cs
      Commands/
        InspectCommand.cs
        ValidatePlanCommand.cs
        RunCommand.cs
        SyncDryRunCommand.cs

    /Core
      Models/
        ExperimentPlan.cs
        DataCatalog.cs
        QueryResult.cs
        EvaluationResult.cs
        Recommendation.cs
        FeatBitActionPlan.cs
      Services/
        PlanValidator.cs
        MetricTemplateRegistry.cs
        RecommendationEngine.cs
        FileStore.cs

    /Data
      /ClickHouse
        ClickHouseConnectionFactory.cs
        ClickHouseSchemaInspector.cs
        ClickHouseQueryRunner.cs

    /Templates
      Sql/
        task_success_rate.sql
        avg_cost.sql
        p95_latency_ms.sql

  /prompts
    planner-system.md
    planner-user-template.md
    summary-system.md
    claude-workflow.md
    featbit-control-policy.md

  /examples
    brief.md
    sample-plan.json
    sample-results.json
    sample-summary.md
    schema-mapping.json

  /scripts
    demo-flow.md
    demo-commands.sh

  /out
    .gitkeep

  README.md
  WHITE_PAPER.md
```

---

## 17. Production Readiness Requirements

The MVP is considered production-ready only if it satisfies the following constraints:

- deterministic command behavior
- explicit failure messages for invalid plans and unsupported schemas
- no dependency on LLM-generated SQL
- auditable artifact output for each decision run
- safe fallback when FeatBit control-plane execution is unavailable
- clear separation between orchestration, control-plane execution, and measurement
- environment-based credential handling for warehouse access
- ability to run the workflow non-interactively from a coding-agent session or automation wrapper

---

## 18. Acceptance Criteria

The production-ready MVP is done when:

- a coding agent can convert a brief into `plan.json`
- a coding agent can generate `featbit-actions.json`
- the workflow can reuse existing FeatBit tooling for control-plane tasks
- `featbit-decision inspect` can write `catalog.json`
- `featbit-decision validate-plan` can reject unsupported plans deterministically
- `featbit-decision run` can execute the three supported metrics and write `results.json`
- a coding agent can produce `summary.md`
- no new feature-flag CRUD or rollout logic is implemented inside the decision runtime
- the workflow can operate with private decision data staying inside the user's environment

---

## 19. Final Definition of This MVP

This MVP is:

> a release decision plugin for coding agents that combines existing FeatBit control-plane tooling with a warehouse-aware deterministic measurement runtime.

This MVP is not:

- a new flag platform
- a general-purpose analytics product
- a standalone agent runtime
- a statistical experimentation platform

This MVP is the smallest production-ready layer that lets coding agents plan, execute, measure, and summarize release decisions on top of FeatBit.
