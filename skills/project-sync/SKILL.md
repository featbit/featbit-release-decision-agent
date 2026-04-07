---
name: project-sync
description: Sync release-decision project state to the web database. Provides the `sync.ts` CLI script that all other skills call to persist state changes (update fields, advance stage, log activities, upsert experiments). Activate whenever a skill needs to write project state to the web DB. Triggers — "sync to web DB", "update project state", "push state", "set stage", "add activity", "upsert experiment", "get project".
license: MIT
metadata:
  author: FeatBit
  version: "1.0.0"
  category: release-management
---

# Project Sync — CLI Bridge to Web Database

This skill provides `sync.ts`, the CLI script that bridges agent skills to the web database.

All release-decision skills call this script to persist state changes. No skill should construct HTTP requests or JSON payloads directly — always use `sync.ts`.

---

## Script Location

```
scripts/sync.ts
```

(Relative to this skill's root directory.)

Run with:

```bash
npx tsx scripts/sync.ts <command> [args]
```

## Environment

Set `SYNC_API_URL` if the web app is not running at the default `http://localhost:3000`.

---

## Commands

### get-project

Read full project state (includes experiments, activities, messages).

```bash
npx tsx scripts/sync.ts get-project <project-id>
```

### update-state

Push one or more decision fields to the web DB.

```bash
npx tsx scripts/sync.ts update-state <project-id> --goal "..." --hypothesis "..." --primaryMetric "..."
```

**Allowed fields:** `goal`, `intent`, `hypothesis`, `change`, `variants`, `primaryMetric`, `guardrails`, `constraints`, `openQuestions`, `lastAction`, `lastLearning`, `flagKey`

### set-stage

Advance the project stage.

```bash
npx tsx scripts/sync.ts set-stage <project-id> <stage>
```

**Valid stages:** `intent`, `hypothesis`, `implementing`, `exposing`, `measuring`, `deciding`, `learning`

### add-activity

Log an activity event.

```bash
npx tsx scripts/sync.ts add-activity <project-id> --type stage_update --title "Intent clarified" [--detail "..."]
```

`--type` and `--title` are required. `--detail` is optional.

### upsert-experiment

Create or update an experiment by slug.

```bash
npx tsx scripts/sync.ts upsert-experiment <project-id> <slug> --status running --primaryMetricEvent "click_cta" [--field value ...]
```

Experiment fields: `status`, `hypothesis`, `primaryMetricEvent`, `guardrailEvents`, `controlVariant`, `treatmentVariant`, `minimumSample` (integer), `observationStart` (ISO 8601 date), `observationEnd` (ISO 8601 date), `priorProper` (boolean, default false), `priorMean` (float), `priorStddev` (float), `inputData` (JSON string — mirrors input.json), `analysisResult` (JSON string — mirrors analysis.json), `decision`, `decisionSummary` (plain-language action), `decisionReason` (technical rationale), `whatChanged`, `whatHappened`, `confirmedOrRefuted`, `whyItHappened`, `nextHypothesis`

---

## How Other Skills Use This Skill

Each satellite skill that needs to persist state declares a dependency on this `project-sync` skill, then lists the commands and arguments it needs. The satellite skill does not hardcode script paths or execution details.

Every stage transition follows this write pattern:

1. `update-state <project-id> --field "value"` — push fields to web DB
2. `set-stage <project-id> <stage>` — advance stage
3. `add-activity <project-id> --type <type> --title "..."` — log transition

When experiment data changes, also call:

4. `upsert-experiment <project-id> <slug> --status running ...`

---

## Architecture

```
Agent skill → references project-sync → npx tsx sync.ts <command> → HTTP API → Prisma → SQLite → Web UI
```

- The web database (via API + Prisma) is the canonical source for all project state
- Skills call `sync.ts` with simple string arguments — no JSON construction needed
