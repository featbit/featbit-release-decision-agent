# FeatBit Release Decision Agent

This repository contains the MVP runtime, prompts, examples, and planning artifacts for a recipe-driven release decision layer.

## What It Does

The current MVP supports a deterministic workflow that:

1. inspects a PostgreSQL data source
2. generates a recipe-driven `plan.json`
3. validates the plan against an inspected catalog
4. runs approved metric templates only
5. writes `results.json` and `summary.md`
6. emits `featbit-actions.json` for dry-run handoff

## Current Scope

1. supported recipes: `agent_variant_comparison`, `website_conversion_change`
2. supported data source kind: `postgres`
3. control output: dry-run FeatBit action plan
4. evaluation method: deterministic rule-based comparison, not formal statistics

## Quickstart

1. set a PostgreSQL connection in `FB_DECISION_PG`
2. review [examples/README.md](c:/Code/featbit/featbit-release-decision-agent/examples/README.md)
3. choose a brief from [examples/agent_variant_comparison/brief.md](c:/Code/featbit/featbit-release-decision-agent/examples/agent_variant_comparison/brief.md) or [examples/website_conversion_change/brief.md](c:/Code/featbit/featbit-release-decision-agent/examples/website_conversion_change/brief.md)
4. run [examples/demo.ps1](c:/Code/featbit/featbit-release-decision-agent/examples/demo.ps1)

## Key Paths

1. runtime CLI: [src/DecisionCli](c:/Code/featbit/featbit-release-decision-agent/src/DecisionCli)
2. core logic: [src/Core](c:/Code/featbit/featbit-release-decision-agent/src/Core)
3. PostgreSQL adapter: [src/Data/Postgres](c:/Code/featbit/featbit-release-decision-agent/src/Data/Postgres)
4. prompts: [prompts](c:/Code/featbit/featbit-release-decision-agent/prompts)
5. examples: [examples](c:/Code/featbit/featbit-release-decision-agent/examples)
6. MVP plan and contracts: [MVP_PLAN](c:/Code/featbit/featbit-release-decision-agent/MVP_PLAN)

## Notes

1. prefer `--connection-env` over raw `--connection`
2. use `column_mappings` when the selected PostgreSQL table uses non-canonical column names
3. direct FeatBit rollout execution is intentionally outside this repo for the MVP
