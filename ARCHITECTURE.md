# Product Structure

This repository should be understood as `release decision skills with toolkit`, not as a single website optimization skill.

## Product Layers

### `skills/`

Agent-facing entry points.

Responsibilities:

1. understand intent
2. pick the right release decision pattern
3. ask for only the missing business inputs
4. orchestrate the toolkit
5. return approval-oriented output

### `slash-commands/`

Human-in-the-loop operator entry points.

Responsibilities:

1. special handling tasks
2. environment and data-source setup
3. inspect-only and validate-only flows
4. support operations that should not require a full decision workflow

### `toolkit/`

Execution kernel.

Responsibilities:

1. schema inspection
2. plan validation
3. approved metric execution
4. recommendation generation
5. summary generation
6. dry-run rollout intent generation

## Current Code Mapping

The code already present in this repo maps to the toolkit layer:

1. `src/DecisionCli`: CLI surface for the toolkit
2. `src/Core`: contracts and deterministic decision logic
3. `src/Data/Postgres`: PostgreSQL adapter
4. `src/Templates/Sql`: approved metric templates

The new agent-facing surface should live beside that code rather than being mixed into it.

## First-Version Structure

```text
skills/
  release_decision.website_change/
    SKILL.md
  release_decision.agent_variant/
    SKILL.md

slash-commands/
  README.md
  configure-data-source.md
  inspect-data-source.md
  run-release-decision.md

toolkit/
  README.md

src/
  DecisionCli/
  Core/
  Data/Postgres/
  Templates/Sql/

examples/
  agent_variant_comparison/
  website_conversion_change/
  demo.ps1
```

## Non-Goals For Structure

1. do not embed release-decision skill wording inside toolkit code paths
2. do not let sample files in `MVP_PLAN` become the primary user entry point
3. do not treat a single use case like website optimization as the product boundary