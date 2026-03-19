# Demo Flow

This document defines a repeatable happy-path demo for the MVP.

## Goal

Show that a user brief can move through inspect, planning, validation, deterministic evaluation, and dry-run control output.

## Preconditions

1. .NET 10 SDK is installed.
2. A PostgreSQL database is reachable.
3. The database connection is stored in an environment variable such as `FB_DECISION_PG`.
4. The inspected table contains the required MVP columns.

## Inputs

Use one of these briefs:

1. `MVP_PLAN/3_SAMPLE_BRIEFS/agent_variant_comparison.brief.md`
2. `MVP_PLAN/3_SAMPLE_BRIEFS/website_conversion_change.brief.md`

## Output Folder

Use a local artifacts folder such as `artifacts/demo`.

## Demo Steps

1. Inspect the PostgreSQL schema.

```powershell
dotnet run --project src/DecisionCli -- inspect --data-source-kind postgres --connection-env FB_DECISION_PG --out artifacts/demo/catalog.json
```

2. Use the planner prompt plus one sample brief to produce `artifacts/demo/plan.json`.

	If the selected table uses different column names, add `column_mappings` to the plan before validation.

3. Validate the plan.

```powershell
dotnet run --project src/DecisionCli -- validate-plan --plan artifacts/demo/plan.json --catalog artifacts/demo/catalog.json
```

4. Run deterministic evaluation.

```powershell
dotnet run --project src/DecisionCli -- run --plan artifacts/demo/plan.json --catalog artifacts/demo/catalog.json --connection-env FB_DECISION_PG --out artifacts/demo/results.json --summary-out artifacts/demo/summary.md
```

5. Generate the dry-run FeatBit action plan.

```powershell
dotnet run --project src/DecisionCli -- sync-dry-run --plan artifacts/demo/plan.json --out artifacts/demo/featbit-actions.json
```

## Expected Demo Outputs

1. `catalog.json`
2. `plan.json`
3. `results.json`
4. `summary.md`
5. `featbit-actions.json`

## Demo Success Criteria

1. `validate-plan` returns no errors.
2. `run` writes deterministic output files.
3. `summary.md` is readable by a non-expert reviewer.
4. `featbit-actions.json` expresses auditable rollout intent.

## Direct-Control Handoff Assumptions

This repo does not execute FeatBit mutations directly.

For the demo, direct control is considered external and optional. The default expected path is dry-run plus handoff to existing authorized FeatBit tooling.

## Failure Cases To Show During Demo

1. unsupported recipe
2. missing required columns
3. invalid time range
4. unavailable connection environment variable