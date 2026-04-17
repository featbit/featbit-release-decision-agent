# experiment-workspace

This skill manages the A/B experiment lifecycle through the database — from starting an experiment to running analysis and reviewing results. All data flows through the HTTP API backed by Prisma + PostgreSQL.

---

## File Map

Every file in this skill belongs to one of three tiers. Before touching any file, check which tier it is in.

### Tier 1 — System-defined 🔒 Do not modify

The framework's core logic and data contracts. These define what an experiment *is* and how analysis works. If you change these, the skill breaks for everyone.

| File | Purpose |
|------|---------|
| `SKILL.md` | Agent instructions — the skill's reasoning and decision logic |
| `scripts/analyze.ts` | Thin wrapper around the web app's `POST /api/experiments/:id/analyze` endpoint |
| `references/experiment-folder-spec.md` | Data contract — defines the shape of the experiment record, `inputData`, `analysisResult` |
| `references/analysis-bayesian.md` | Documentation for the Bayesian algorithm and output format |
| `references/analysis-bandit.md` | Documentation for the Thompson Sampling algorithm |

The statistical algorithms themselves (Bayesian A/B, Thompson Sampling, SRM check, GaussianPrior) live on the server in the web app (`src/lib/stats/`). Data collection from instrumentation goes through `track-service`. The agent never runs the statistical code locally — it triggers `analyze.ts`, which calls the server, which does the math and writes results back to the DB.

### Tier 2 — Practice defaults 📋 Replace or extend for your stack

These files implement a default approach. If the default works for you, use it as-is. If your team uses a different data source, statistical method, or tooling, **replace or add a new reference file and update `SKILL.md` to point to it**.

| File | Default | What to replace it with |
|------|---------|------------------------|
| `references/data-source-guide.md` | track-service (FeatBit events) | Your own data source patterns — add a `§YourTool` section, or replace entirely |

> If you add a new statistical method (e.g. frequentist), implement it server-side under `src/lib/stats/` in the web app, wire it into `/api/experiments/:id/analyze`, then add a new `references/analysis-frequentist.md` and update `SKILL.md` to route to the right method based on context.

### Tier 3 — User-defined ✏️ Stored in the database

These are not files — they are fields in the experiment's database record. The agent will help you create them, but the content is yours.

| DB Field | Purpose | Who writes it |
|----------|---------|---------------|
| Experiment record (slug, variants, metrics, observation window, etc.) | Your experiment's parameters | Agent creates via API; you validate |
| `inputData` | Raw metric data — exposed counts and conversion counts per variant | Written by the web `/analyze` endpoint after querying `track-service` |
| `analysisResult` | Analysis results | Written by the web `/analyze` endpoint (Bayesian or Bandit per the run's `method`) |

---

## How customization works

The usual customization path is:

1. Your data lives somewhere specific (FeatBit API, a Postgres DB, a Redshift table, an MCP tool)
2. You implement the collection step in whatever way fits your stack — script, CLI command, MCP call
3. That step writes `inputData` in the format defined in `references/experiment-folder-spec.md`
4. Everything downstream (`analyze-bayesian.ts`, `analyze-bandit.ts`) works unchanged

The only data you must produce is `inputData`. How you produce it is your choice.

---

## Extending this skill

If you add a new data source pattern or a new statistical method:

1. Add a new reference file to `references/` (e.g. `tool-redshift.md`, `analysis-frequentist.md`)
2. Update `SKILL.md` → **Reference Files** section to include it
3. If it changes how the agent should behave, update the relevant **Decision Actions** section in `SKILL.md`

This keeps Tier 1 (core contracts) stable while Tier 2 grows with your team's practice.
