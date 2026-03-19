# FeatBit Release Decision Agent — Handbook

This repository is the **handbook and specification source** for the FeatBit release decision system.

Executable artifacts have been distributed to their canonical homes:

| Artifact | Repo | Path |
|---|---|---|
| Agent skill | [featbit-skills](https://github.com/featbit/featbit-skills) | `skills/featbit-decision/` |
| CLI commands (`decision` group) | [featbit-cli](https://github.com/featbit/featbit-cli) | `src/FeatBit.Cli/` |

This repo contains:

1. `SPEC.md` / `SPEC_CN.md` — full product specification
2. `WHITE_PAPER.md` / `WHITE_PAPER_CN.md` — concept and rationale
3. `PRACTICAL_VALIDATION.md` / `PRACTICAL_VALIDATION_CN.md` — validation guide
4. `PITCH_ONE_LINER.md` — one-liner pitch

## How It Works

The `featbit-decision` skill (in `featbit-skills`) guides an agent through a four-command workflow:

```
featbit decision inspect   --connection-env <ENV_VAR> --out catalog.json
featbit decision validate-plan --plan plan.json --catalog catalog.json
featbit decision run       --plan plan.json --catalog catalog.json \
                           --connection-env <ENV_VAR> --out results.json --summary-out summary.md
featbit decision sync-dry-run --plan plan.json --out featbit-actions.json
```

The commands are implemented in `featbit-cli`. They operate on a PostgreSQL data source and local files — no FeatBit API token required.

## Supported Recipes

| Recipe | Use For |
|---|---|
| `website_conversion_change` | Homepage, CTA, onboarding, or conversion-focused page changes |
| `agent_variant_comparison` | Coding agents, prompt variants, or workflow version comparisons |

## Key Design Constraints

1. Connection strings are always passed via environment variable name — never embedded in files.
2. Metric selection is recipe-driven — the agent does not ask the user to choose metrics.
3. All FeatBit control actions are dry-run by default (`featbit-actions.json` for operator review).
4. Evaluation is deterministic and rule-based — no formal statistical inference claimed.
