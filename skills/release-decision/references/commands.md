# CLI Command Reference

All `featbit decision` commands operate on local files and a PostgreSQL data source. They do not require `--host`, `--token`, or `--org`.

## featbit decision inspect

Connects to a PostgreSQL database and introspects the schema. Writes a `catalog.json` file describing available tables and their columns.

```bash
featbit decision inspect \
  --connection-env <ENV_VAR> \
  --out <path/to/catalog.json>
```

| Option | Required | Description |
|---|---|---|
| `--connection-env` | Yes | Name of the environment variable holding the full Postgres connection string |
| `--out` | Yes | Output path for `catalog.json` |

**Example:**

```bash
export FB_DECISION_PG="Host=localhost;Port=5432;Database=experiments;Username=reader;Password=..."
featbit decision inspect --connection-env FB_DECISION_PG --out artifacts/catalog.json
```

---

## featbit decision validate-plan

Validates a `plan.json` against a `catalog.json`. Checks that the selected table, columns, recipe, and metric pack are consistent.

```bash
featbit decision validate-plan \
  --plan <path/to/plan.json> \
  --catalog <path/to/catalog.json>
```

| Option | Required | Description |
|---|---|---|
| `--plan` | Yes | Path to `plan.json` |
| `--catalog` | Yes | Path to `catalog.json` produced by `inspect` |

**Exit codes:** `0` = valid, `1` = validation failed (see stderr for details)

---

## featbit decision run

Runs the full evaluation: queries PostgreSQL with the approved SQL templates, evaluates metrics, applies the recommendation engine, and writes `results.json` and `summary.md`.

```bash
featbit decision run \
  --plan <path/to/plan.json> \
  --catalog <path/to/catalog.json> \
  --connection-env <ENV_VAR> \
  --out <path/to/results.json> \
  --summary-out <path/to/summary.md>
```

| Option | Required | Description |
|---|---|---|
| `--plan` | Yes | Path to `plan.json` |
| `--catalog` | Yes | Path to `catalog.json` |
| `--connection-env` | Yes | Name of the environment variable holding the connection string |
| `--out` | Yes | Output path for `results.json` |
| `--summary-out` | Yes | Output path for `summary.md` |

**Recommendation values in `results.json`:**

| Value | Meaning |
|---|---|
| `continue` | All metrics meet exit criteria. Safe to extend rollout. |
| `pause` | Primary metric is improving but a guardrail is outside threshold. Hold rollout, investigate. |
| `rollback_candidate` | Primary metric has regressed significantly. Recommend rollback or flag disable. |
| `inconclusive` | Insufficient data or high variance. Collect more events before deciding. |

---

## featbit decision sync-dry-run

Generates a `featbit-actions.json` file describing the recommended FeatBit flag operation without applying it. For operator or automation review.

```bash
featbit decision sync-dry-run \
  --plan <path/to/plan.json> \
  --out <path/to/featbit-actions.json>
```

| Option | Required | Description |
|---|---|---|
| `--plan` | Yes | Path to `plan.json` |
| `--out` | Yes | Output path for `featbit-actions.json` |

---

## Artifact Directory Convention

By convention, all artifacts are written to an `artifacts/` directory in the working directory. Create it before running commands:

```bash
mkdir -p artifacts
```

## Connection String Security

Never embed the connection string in any argument, artifact, or log output. Always:

1. Store the connection string in an environment variable (e.g. `FB_DECISION_PG`).
2. Pass only the variable **name** to `--connection-env`.
3. Verify the variable is set before running commands.

```bash
# Check before running
if [ -z "$FB_DECISION_PG" ]; then
  echo "error: FB_DECISION_PG is not set"
  exit 1
fi
```
