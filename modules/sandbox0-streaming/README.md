# sandbox0-streaming

Hono server (port `3100`) that brokers FeatBit release-decision conversations between the web UI and sandbox0 Managed Agents.

## Overview

```
FeatBit Web UI  ──►  /chat/start · /chat/send · /chat/events   (Hono, port 3100)
                            │
                            ├─ PostgreSQL              (experiment.sandbox_id, managed_agent, vault)
                            │
                            └─ sandbox0 Managed Agents REST API
                                    │
                                    ▼
                               Session VM
                               ├─ skill files at /workspace/.claude/skills/
                               └─ bash tool  →  https://www.featbit.ai   (web API)
```

One session per experiment. The session is a short-lived cache; the **web database is the durable memory**. A fresh session rebuilds its working context by calling `get-experiment` at bootstrap.

## Identity model

Three kinds of state live in three different places:

| What | Where | How populated |
|---|---|---|
| Credentials (`SANDBOX0_API_KEY`, `LLM_API_KEY`, `DATABASE_URL`) | `.env` | by hand |
| `agent_id`, `environment_id`, `vault_id` | PostgreSQL `managed_agent` + `vault` tables | `npm run setup-agent` / `setup-vaults` |
| Agent configuration (model, system prompt, skills, tools) | sandbox0 cloud (`agents.sandbox0.ai`) | `setup-agent` creates, `sync-skills` updates |
| Experiment ↔ session mapping | `experiment.sandbox_id` column | `resolveSession` writes on first use |
| Conversation state (goal, hypothesis, activities, runs, decisions) | `experiment` / `activity` / `experiment_run` tables via the web app | the release-decision skills write through the web API |

The default `managed_agent` row (`is_default=true`) is the system's root. `session.ts` reads it on every `/chat/start`.

## One-time setup

Run exactly once per deployment:

```bash
npm run setup-vaults   # Create an LLM vault, persist vault_id in DB
npm run setup-agent    # Create an environment + agent, persist their IDs as the is_default row
```

After these succeed, `managed_agent` and `vault` each hold exactly one row. Do not re-run them — repeated runs create duplicate cloud resources and ambiguous DB rows.

## Skill update loop

Whenever skills under the repo's top-level `skills/<name>/` change:

```bash
npm run sync-skills
```

Behavior:

1. Lists the skills that already exist on sandbox0.
2. Uploads a new version of each from the local folder (multipart).
3. Calls `POST /v1/agents/{id}` on the default agent with `{version: currentVersion, skills: [...]}`. Sandbox0 bumps the agent version in place — `agent_id` stays stable, only the integer version increments.
4. Subsequent sessions create with `agent: <agent_id>` (bare string = "latest"), so they pick up the new version automatically.

`sync-skills` deliberately does **not**:

- Create a new agent. Skills change, the agent's version number changes, but `agent_id` and the `managed_agent` row are stable.
- Create a new skill. A local folder under `~/.claude/skills/` that does not already exist on sandbox0 is silently skipped. The allowlist of skills attached to this agent belongs on the sandbox0 side, not on the local filesystem. Onboarding a new skill requires a deliberate manual step (create the skill on sandbox0 first, attach it to the agent, then `sync-skills` will maintain it).

## Session lifecycle

`POST /chat/start { experimentId }` calls `resolveSession`:

- **`sandbox_id` set and the session is still alive** → reuse. Conversation context preserved. The session remains pinned to whatever agent version it was created with; skill updates published after its creation are invisible to it.
- **No `sandbox_id`, or the session is terminated** → create a new session pinned to the current latest agent version, send the bootstrap message `/featbit-release-decision <experimentId> <accessToken>`, persist the new `sandbox_id`.

### Bootstrap

The first thing the agent does on a fresh session (driven by `featbit-release-decision/SKILL.md`):

1. Create a symlink so skill scripts can use `$HOME/.claude/skills/...` paths. On sandbox0 VMs, skills are materialized at `/workspace/.claude/skills/`, not at `$HOME/.claude/skills/`:
   ```bash
   [ -d "$HOME/.claude/skills" ] || { mkdir -p "$HOME/.claude" && ln -sfn /workspace/.claude/skills "$HOME/.claude/skills"; }
   ```
2. Call `get-experiment` through `project-sync` to load decision state from the web API.
3. Greet based on state — blank projects get one short question; non-blank projects get a terse recap.

### Forcing a session rebuild

To make a specific experiment's next conversation pick up the latest skill versions (e.g. after `sync-skills`):

```sql
UPDATE experiment SET sandbox_id = NULL, sandbox_status = NULL WHERE id = '<experiment-id>';
```

Optionally also terminate the orphaned session on sandbox0 to free its VM; see _Ops_ below. There is no automatic upgrade mechanism by design — version locking is a feature (reproducibility, conversation continuity). New skills arrive when a session rotates.

## Environment tuning

The environment's `packages` field pre-installs tools so VMs do not pay for them on each cold start:

```
POST /v1/environments/{id}
{
  "config": {
    "type": "cloud",
    "networking": { "type": "unrestricted" },
    "packages": { "npm": [...], "apt": [...], "pip": [...], "cargo": [...], "gem": [...], "go": [...] }
  }
}
```

Current state: `npm: ["tsx"]`. Pre-installed `tsx` lands at `/opt/managed-env/npm/bin/tsx` and is on `$PATH`, so the first `npx tsx scripts/sync.ts ...` call no longer pays the ~10 s cold-download cost. Sandbox0 fixed the env-build pipeline (previously `504 resolve environment artifact: npm build failed` for packages pulling native binaries like tsx → esbuild). To re-apply or extend the package list run `npm run sandbox0:update-env` from `modules/web`.

## Ops

All commands assume `SANDBOX0_API_KEY` and `SANDBOX0_BASE_URL=https://agents.sandbox0.ai` are in the shell environment.

```bash
HDR="-H x-api-key:$SANDBOX0_API_KEY -H anthropic-version:2023-06-01 -H anthropic-beta:managed-agents-2026-04-01"

# Inspect the current default agent (id, version, attached skills)
curl -s $HDR $SANDBOX0_BASE_URL/v1/agents/<agent_id> | jq .

# List active (non-archived) agents
curl -s $HDR "$SANDBOX0_BASE_URL/v1/agents?limit=50" | jq '.data[] | select(.archived_at==null) | {id, name, version}'

# List custom skills on sandbox0
curl -s $HDR "$SANDBOX0_BASE_URL/v1/skills?limit=50" | jq '.data[] | {id, display_title, latest_version}'

# Terminate a live session
curl -s -X DELETE $HDR $SANDBOX0_BASE_URL/v1/sessions/<sesn_id>

# Archive an obsolete agent (DELETE is not supported)
curl -s -X POST $HDR -H "Content-Type: application/json" \
  $SANDBOX0_BASE_URL/v1/agents/<agent_id>/archive -d '{}'

# Rotate the LLM token while keeping the existing vault_id
NEW_LLM_API_KEY=<new-key> npm run rotate-llm-key
```

## Known issues

`sandbox0-issue.md` documents a GCS 429 rate limit that can hit session creation when a custom skill contains many files (write amplification on `manifests/latest.json`). Keep each skill's file count modest; `sync-skills` uploads skill directories as-is.

## Scripts reference

| Script | Purpose | Run frequency |
|---|---|---|
| `setup-vaults.ts` | Create LLM vault, persist `vault_id` | once |
| `setup-agent.ts`  | Create environment + agent, persist IDs as the `is_default` row | once |
| `sync-skills.ts`  | Upload new skill versions, bump agent version in place | on skill edits |
| `rotate-llm-key.ts` | Rotate the bearer token on the existing LLM vault | on key rotation |
| `src/index.ts`    | Hono server (`npm run dev` / `npm start`) | always |
