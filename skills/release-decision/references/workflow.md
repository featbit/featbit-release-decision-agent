# Release Decision Workflow

Full orchestration rules for the `release-decision` skill. Follow these rules exactly.

## Execution Order

1. Read the user brief and identify which recipe applies.
2. Run `featbit-decision inspect` to discover available tables and columns.
3. Generate `plan.json` using the planner system prompt with the brief + `catalog.json` as inputs.
4. Run `featbit-decision validate-plan`. Stop if validation fails — explain the failure to the user.
5. Run `featbit-decision run` to produce `results.json` and `summary.md`.
6. Apply the control policy to determine the output path.
7. If direct control is not available or not authorized, run `featbit-decision sync-dry-run` to produce `featbit-actions.json`.
8. Present the recommendation card to the user.

## Artifact Order

Artifacts are produced in this sequence:

| Order | Artifact | Produced By |
|---|---|---|
| 1 | `artifacts/catalog.json` | `featbit-decision inspect` |
| 2 | `artifacts/plan.json` | Planner LLM call |
| 3 | `artifacts/results.json` | `featbit-decision run` |
| 4 | `artifacts/summary.md` | `featbit-decision run` |
| 5 | `artifacts/featbit-actions.json` | `featbit-decision sync-dry-run` _(if needed)_ |

## Planning Rules

- Choose exactly one supported recipe: `website_conversion_change` or `agent_variant_comparison`.
- Use only the recipe's default metric pack — do not ask the user to pick metrics.
- Use `postgres` as `data_source_kind`.
- Select a table only when `catalog.json` shows the required columns are present (directly or through `column_mappings`).
- Reject the request if no table satisfies the schema requirements — explain the mismatch.
- Keep the initial rollout percentage conservative (default: 10%).
- Never embed credentials or connection strings in `plan.json`.

## Evaluation Rules

- Treat CLI output as authoritative. Do not replace CLI execution with informal reasoning.
- Do not run arbitrary SQL queries.
- Do not skip `validate-plan` under any circumstances.
- Treat `results.json` as the machine-readable source of truth for the recommendation.

## Summary Rules

- Keep the recommendation aligned with `results.json`.
- Use reviewer language: "directionally positive", "within guardrail bounds", "meets exit criteria", "outside guardrail threshold".
- Do not claim statistical significance.
- Do not expose internal artifact paths or JSON structure in the output card unless debugging.

## Control Policy

Two paths are permitted:

### Dry-Run Path (default)

Use when FeatBit management tooling is not available in the current environment, or when authorization is unclear.

- Run `featbit-decision sync-dry-run` to produce `featbit-actions.json`.
- Present the action file content for operator review.
- The action remains auditable and reversible.

### Direct Execution Path

Use only when:
- Existing FeatBit tooling (CLI, MCP, API) is already present in the environment.
- Authorization to apply rollout changes has been explicitly granted in the session.

## Failure Rules

Stop immediately and report to the user when:

- `validate-plan` fails for any reason
- `inspect` cannot connect to the data source
- No table in `catalog.json` satisfies the recipe's required columns
- `run` produces a recommendation of `inconclusive` — explain why and suggest next steps (more data, different table, different recipe)
