# Examples

This folder contains runtime-facing examples for the toolkit layer.

## Included Examples

1. `agent_variant_comparison/brief.md`
2. `website_conversion_change/brief.md`
3. `demo.ps1`

## Intended Use

Use these examples when you want to run the toolkit from the repo root without reading the planning documents first.

## Typical Flow

1. choose one brief
2. inspect a PostgreSQL schema into `artifacts/demo/catalog.json`
3. turn the brief into `artifacts/demo/plan.json` using the instruction prompts in `prompts/`
4. validate the plan
5. run deterministic evaluation
6. emit `featbit-actions.json` for dry-run handoff

## Command Reference

```powershell
dotnet run --project src/DecisionCli -- inspect --data-source-kind postgres --connection-env FB_DECISION_PG --out artifacts/demo/catalog.json
dotnet run --project src/DecisionCli -- validate-plan --plan artifacts/demo/plan.json --catalog artifacts/demo/catalog.json
dotnet run --project src/DecisionCli -- run --plan artifacts/demo/plan.json --catalog artifacts/demo/catalog.json --connection-env FB_DECISION_PG --out artifacts/demo/results.json --summary-out artifacts/demo/summary.md
dotnet run --project src/DecisionCli -- sync-dry-run --plan artifacts/demo/plan.json --out artifacts/demo/featbit-actions.json
```

## Notes

1. prefer `--connection-env`
2. use `column_mappings` in `plan.json` when the inspected table does not use canonical MVP column names
3. direct FeatBit rollout execution is outside this repo; default behavior is dry-run