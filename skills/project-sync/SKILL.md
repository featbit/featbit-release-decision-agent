---
name: project-sync
description: Sync release-decision experiment state to the web database. Provides the `sync.ts` CLI script that all other skills call to persist state changes (update fields, advance stage, log activities, manage experiment runs). Activate whenever a skill needs to write experiment state to the web DB. Triggers — "sync to web DB", "update experiment state", "push state", "set stage", "add activity", "create run", "start run", "analyze run", "decide run", "archive run", "record decision", "save learning", "get experiment".
license: MIT
metadata:
  author: FeatBit
  version: "2.0.0"
  category: release-management
---

# Project Sync — CLI Bridge to Web Database

This skill provides `sync.ts`, the CLI script that bridges agent skills to the web database.

All release-decision skills call this script to persist state changes. **No skill should construct HTTP requests or JSON payloads directly — always use `sync.ts`.**

---

## Script Location

```
scripts/sync.ts
```

Run with:

```bash
npx tsx scripts/sync.ts <command> [args]
```

## Environment

Set `SYNC_API_URL` if the web app is not running at the default `http://localhost:3000`.

---

## Canonical Enums

These are the only valid values for each enum field. The script and server API **both** enforce them — using any other value will return an error.

| Field | Valid Values |
|---|---|
| `stage` | `intent` \| `hypothesis` \| `implementing` \| `measuring` \| `learning` |
| `activity type` | `stage_update` \| `field_update` \| `run_created` \| `run_collecting` \| `run_analyzing` \| `run_decided` \| `run_archived` \| `decision_recorded` \| `learning_captured` |
| `run status` | `draft` \| `collecting` \| `analyzing` \| `decided` \| `archived` — **NEVER use `running`, `paused`, `completed` or any other value.** Each status has its own dedicated CLI command — the command name *is* the status. |
| `method` | `bayesian_ab` \| `frequentist` \| `bandit` |
| `decision` | `CONTINUE` \| `PAUSE` \| `ROLLBACK` \| `INCONCLUSIVE` |
| `primaryMetricType` | `binary` \| `continuous` |
| `primaryMetricAgg` | `once` \| `sum` \| `last` |

---

## Field Format Standards

| Field | Format | Example |
|---|---|---|
| `variants` (on project state) | Pipe-separated `"key (annotation)\|key (annotation)"` | `"standard (control)\|streamlined (treatment)"` |
| `primaryMetric` (on project state) | Plain text paragraph — metric event name + rationale | `"purchase_completed — chosen as north star because it directly measures the revenue impact of the checkout redesign."` |
| `guardrails` (on project state) | Newline-separated plain text descriptions | `"checkout_abandoned must not increase\nsupport_chat_open must stay below 5%"` |
| `guardrailEvents` (on run) | **Comma-separated** event names — sync.ts converts to JSON array | `"checkout_abandoned,support_chat_open"` |
| `inputData` | Valid JSON string — raw metrics snapshot | `'{"metrics":{"control":{"n":1000},"treatment":{"n":1020}}}'` |
| `analysisResult` | Valid JSON string — Bayesian output | `'{"decision":"CONTINUE","probability":0.87}'` |

---

## Commands

### get-experiment

Read full project state (includes experiment runs, activities, messages).

```bash
npx tsx scripts/sync.ts get-experiment <experiment-id>
```

---

### update-state

Push one or more decision-state fields to the web DB.

```bash
npx tsx scripts/sync.ts update-state <experiment-id> \
  --goal "..." \
  --intent "..." \
  --hypothesis "..." \
  --change "..." \
  --variants "standard (control)|streamlined (treatment)" \
  --primaryMetric "purchase_completed — north star metric because ..." \
  --guardrails "checkout_abandoned must not increase" \
  --constraints "..." \
  --flagKey "my-flag-key"
```

**Allowed fields:** `goal`, `intent`, `hypothesis`, `change`, `variants`, `primaryMetric`, `guardrails`, `constraints`, `openQuestions`, `lastAction`, `lastLearning`, `flagKey`

> **variants format**: must be pipe-separated strings — NOT JSON. Use `"key (annotation)|key (annotation)"`.

---

### set-stage

Advance the project stage.

```bash
npx tsx scripts/sync.ts set-stage <experiment-id> <stage>
```

**Valid stages:** `intent` | `hypothesis` | `implementing` | `measuring` | `learning`

---

### add-activity

Log an activity event.

```bash
npx tsx scripts/sync.ts add-activity <experiment-id> --type <type> --title "..." [--detail "..."]
```

`--type` and `--title` are required. Use `--detail` for longer technical notes.

---

### create-run

Create a new experiment run (status starts as `draft`).

```bash
npx tsx scripts/sync.ts create-run <experiment-id> <slug> \
  --hypothesis "Adding streamlined checkout will increase purchase_completed" \
  --method bayesian_ab \
  --primaryMetricEvent purchase_completed \
  --primaryMetricType binary \
  --primaryMetricAgg once \
  --controlVariant standard \
  --treatmentVariant streamlined \
  --guardrailEvents "checkout_abandoned,support_chat_open" \
  --minimumSample 1000 \
  --trafficPercent 100 \
  --priorProper false \
  --priorMean 0.1 \
  --priorStddev 0.05 \
  --observationStart 2024-01-15T00:00:00Z \
  --observationEnd 2024-01-29T00:00:00Z
```

`guardrailEvents` accepts comma-separated event names — sync.ts converts them to a JSON array for storage.

---

### Run status transitions

One command per status — **never pass a status string**; pick the command that matches the target state. There is intentionally no generic `set-run-status` command.

| Command | Writes status |
|---|---|
| `start-run <experiment-id> <slug>` | `collecting` |
| `analyze-run <experiment-id> <slug>` | `analyzing` |
| `decide-run <experiment-id> <slug>` | `decided` |
| `archive-run <experiment-id> <slug>` | `archived` |

```bash
# Begin collecting data for an existing draft run
npx tsx scripts/sync.ts start-run <experiment-id> <slug>

# Move to the analysis phase
npx tsx scripts/sync.ts analyze-run <experiment-id> <slug>

# Record that a decision has been reached
npx tsx scripts/sync.ts decide-run <experiment-id> <slug>

# Archive a run that is no longer in play
npx tsx scripts/sync.ts archive-run <experiment-id> <slug>
```

---

### save-input

Save the raw metrics snapshot collected for this run.

```bash
npx tsx scripts/sync.ts save-input <experiment-id> <slug> \
  --inputData '{"metrics":{"control":{"n":1000,"conversions":87},"treatment":{"n":1020,"conversions":104}}}'
```

`--inputData` must be a valid JSON string.

---

### save-result

Save the Bayesian analysis output for this run.

```bash
npx tsx scripts/sync.ts save-result <experiment-id> <slug> \
  --analysisResult '{"decision":"CONTINUE","probability":0.87,"rope":{"low":0.0,"high":0.01}}'
```

`--analysisResult` must be a valid JSON string.

---

### record-decision

Record the human/agent decision for this run.

```bash
npx tsx scripts/sync.ts record-decision <experiment-id> <slug> \
  --decision CONTINUE \
  --decisionSummary "Roll out streamlined checkout to 100% of users" \
  --decisionReason "Treatment shows 87% probability of beating control; ROPE analysis clear"
```

`--decision` must be one of: `CONTINUE | PAUSE | ROLLBACK | INCONCLUSIVE`  
`--decisionSummary` is required (plain-language recommended action).  
`--decisionReason` is optional (technical rationale).

---

### save-learning

Capture structured learnings at the end of a cycle.

```bash
npx tsx scripts/sync.ts save-learning <experiment-id> <slug> \
  --whatChanged "Reduced checkout to 2 steps" \
  --whatHappened "Conversion increased by +2.3pp (p=0.87 Bayesian)" \
  --confirmedOrRefuted "confirmed" \
  --whyItHappened "Fewer steps reduced abandonment friction" \
  --nextHypothesis "A payment-method pre-fill will further reduce drop-off"
```

At least one learning field is required. All five fields are strongly recommended.

---

## Standard Write Pattern Per Stage Transition

Every stage transition follows this write sequence:

```bash
# 1. Push the fields produced in this stage
npx tsx scripts/sync.ts update-state <experiment-id> --hypothesis "..."

# 2. Advance stage
npx tsx scripts/sync.ts set-stage <experiment-id> <next-stage>

# 3. Log the transition
npx tsx scripts/sync.ts add-activity <experiment-id> --type stage_update --title "Moved to <next-stage>"
```

When starting an experiment run:

```bash
# 4a. Create the run (draft)
npx tsx scripts/sync.ts create-run <experiment-id> <slug> --method bayesian_ab ...

# 4b. Activate it
npx tsx scripts/sync.ts start-run <experiment-id> <slug>

npx tsx scripts/sync.ts add-activity <experiment-id> --type run_started --title "Run <slug> started"
```

When recording a decision:

```bash
npx tsx scripts/sync.ts record-decision <experiment-id> <slug> --decision CONTINUE --decisionSummary "..."
npx tsx scripts/sync.ts complete-run <experiment-id> <slug>
npx tsx scripts/sync.ts add-activity <experiment-id> --type decision_recorded --title "Decision: CONTINUE"
```

---

## Architecture

```
Agent skill → project-sync → npx tsx sync.ts <command> → HTTP API → Prisma → PostgreSQL → Web UI
```

- The web database (via API + Prisma) is the canonical source for all project state.
- Skills pass simple string arguments — no JSON construction needed.
- The script validates all enums and formats before making any HTTP calls.
