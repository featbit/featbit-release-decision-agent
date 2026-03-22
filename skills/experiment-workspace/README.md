# experiment-workspace

This skill manages the A/B experiment lifecycle as local files — from starting an experiment to running analysis and archiving results.

---

## File Map

Every file in this skill belongs to one of three tiers. Before touching any file, check which tier it is in.

### Tier 1 — System-defined 🔒 Do not modify

The framework's core logic and data contracts. These define what an experiment *is* and how analysis works. If you change these, the skill breaks for everyone.

| File | Purpose |
|------|---------|
| `SKILL.md` | Agent instructions — the skill's reasoning and decision logic |
| `scripts/analyze-bayesian.py` | Bayesian analysis engine — reads `input.json`, writes `analysis.md` |
| `scripts/check-sample.sh` | Sample size checker — reads `input.json` and `definition.md` |
| `references/experiment-folder-spec.md` | Data contract — defines the exact shape of `definition.md`, `input.json`, `analysis.md` |
| `references/analysis-bayesian.md` | Documentation for `analyze-bayesian.py` — explains the algorithm and output format |

### Tier 2 — Practice defaults 📋 Replace or extend for your stack

These files implement a default approach. If the default works for you, use it as-is. If your team uses a different data source, statistical method, or tooling, **replace or add a new reference file and update `SKILL.md` to point to it**.

| File | Default | What to replace it with |
|------|---------|------------------------|
| `references/data-source-guide.md` | FeatBit API, PostgreSQL, custom HTTP | Your own data source patterns — add a `§YourTool` section, or replace entirely |
| `scripts/collect-input.py` | Python script scaffolding for `fetch_metric_summary()` | Any tool that produces `input.json` in the correct format (CLI, MCP, SQL export, etc.) |

> If you replace `collect-input.py` with a different mechanism (e.g. an MCP tool or a shell script), remove it from `scripts/` and update the "I want to update the data" action in `SKILL.md`.

> If you add a new statistical method (e.g. frequentist), add a new `scripts/analyze-frequentist.py` and `references/analysis-frequentist.md`, then update `SKILL.md` to route to the right script based on context.

### Tier 3 — User-defined ✏️ You create and own these

These files do not exist until you create them. They represent your specific experiment context and data. The agent will help you create them, but the content is yours.

| File (in your project) | Purpose | Who writes it |
|------------------------|---------|---------------|
| `.featbit-release-decision/experiments/<slug>/definition.md` | Your experiment's parameters — flag key, variants, metrics, observation window | Agent creates from template; you validate |
| `.featbit-release-decision/experiments/<slug>/input.json` | Raw metric data — exposed counts and conversion counts per variant | Your data collection mechanism produces this |
| `.featbit-release-decision/experiments/<slug>/analysis.md` | Analysis results | `analyze-bayesian.py` writes this automatically |
| `.featbit-release-decision/experiments/<slug>/decision.md` | Structured release decision | Agent writes after `evidence-analysis` |

---

## How customization works

The usual customization path is:

1. Your data lives somewhere specific (FeatBit API, a Postgres DB, a Redshift table, an MCP tool)
2. You implement the collection step in whatever way fits your stack — script, CLI command, MCP call
3. That step writes `input.json` in the format defined in `references/experiment-folder-spec.md`
4. Everything downstream (`check-sample.sh`, `analyze-bayesian.py`) works unchanged

The only file you must produce is `input.json`. How you produce it is your choice.

---

## Extending this skill

If you add a new data source pattern or a new statistical method:

1. Add a new reference file to `references/` (e.g. `tool-redshift.md`, `analysis-frequentist.md`)
2. Update `SKILL.md` → **Reference Files** section to include it
3. If it changes how the agent should behave, update the relevant **Decision Actions** section in `SKILL.md`

This keeps Tier 1 (core contracts) stable while Tier 2 grows with your team's practice.
