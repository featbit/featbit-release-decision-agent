# Claude Workflow

This document defines the exact execution order for the FeatBit release decision MVP.

## Goal

Take a user brief, inspect a PostgreSQL data source, generate decision artifacts, run deterministic evaluation, and either hand off direct control intent or stop at dry-run.

## Supported Runtime Commands

```powershell
dotnet run --project src/DecisionCli -- inspect --data-source-kind postgres --connection-env FB_DECISION_PG --out artifacts/catalog.json
dotnet run --project src/DecisionCli -- validate-plan --plan artifacts/plan.json --catalog artifacts/catalog.json
dotnet run --project src/DecisionCli -- run --plan artifacts/plan.json --catalog artifacts/catalog.json --connection-env FB_DECISION_PG --out artifacts/results.json --summary-out artifacts/summary.md
dotnet run --project src/DecisionCli -- sync-dry-run --plan artifacts/plan.json --out artifacts/featbit-actions.json
```

## Execution Order

1. Read the user brief.
2. Map the brief to one supported recipe.
3. Run `inspect` against PostgreSQL and write `catalog.json`.
4. Generate `plan.json` with the planner prompt.
5. Run `validate-plan`.
6. If validation fails, stop and explain the exact failure.
7. Run `run` to produce `results.json` and `summary.md`.
8. Apply the control policy.
9. If direct FeatBit control is not available, run `sync-dry-run` to write `featbit-actions.json`.
10. Present the decision summary and next action.

## Artifact Order

Artifacts should appear in this order:

1. `catalog.json`
2. `plan.json`
3. `results.json`
4. `summary.md`
5. `featbit-actions.json` when needed

## Planning Phase

Use `prompts/planner-system.md` to generate `plan.json`.

Rules:

- choose only one supported recipe
- use recipe-defined metrics and guardrails
- use `postgres` as `data_source_kind`
- choose a table from `catalog.json` only when the required columns exist
- never put secrets in artifacts

## Evaluation Phase

Use the CLI as the source of truth.

Rules:

- do not replace CLI execution with informal reasoning
- do not run arbitrary SQL
- do not skip `validate-plan`
- treat `results.json` as the authoritative machine-readable output

## Summary Phase

Use `prompts/summary-system.md` when a human-readable explanation is needed beyond the CLI-generated summary.

Rules:

- keep the recommendation aligned with `results.json`
- explain in reviewer language
- do not claim statistical significance

## Control Phase

Use `prompts/featbit-control-policy.md`.

Two paths are allowed:

### Direct Execution Path

Use this only if existing FeatBit tooling is already available and authorized in the environment.

Outcome:

- rollout intent is applied by external approved tooling
- the action remains auditable

### Dry-Run Path

Use this by default.

Outcome:

- `featbit-actions.json` is generated
- an operator or existing FeatBit automation applies the change later

## Failure Rules

Stop immediately when:

- no supported recipe matches the brief
- no compatible table exists in `catalog.json`
- `validate-plan` fails
- the data source connection is unavailable
- the results are structurally incomplete

## Security Rules

- prefer `--connection-env`
- do not write raw connection strings into prompts, plans, logs, or summaries
- do not assume direct FeatBit access
- keep artifacts machine-readable and reviewable