# project-agent — implementation progress log

Running log of what has been built around `modules/project-agent/`, in the order it happened, so a future session can resume cleanly.

## Starting premise (agreed before any code)

- **What we're building**: a project-level agent that runs on first login / new project to elicit product context, then stays available via a global header entry point. Holds the shared "project pool" (memory) that downstream experiment skills will consume.
- **Why not an auto-capture analytics SDK**: auto-captured events lack semantic meaning; user-elicited context is more useful for forming hypotheses than raw event streams. We explicitly deferred inbound GA/Mixpanel connectors — not the right stage yet.
- **Agent relationship**: project-agent (this module) is separate from `modules/sandbox` / `modules/sandbox0-streaming` (per-experiment agents). Skills split accordingly: experiment-execution skills stay in `skills/`; project-level skills live in `skills-project/`.
- **Runtime choice**: OpenAI Codex SDK (`@openai/codex-sdk`), not Claude Agent SDK. Skill contract is runtime-neutral markdown so either runtime could load them.

## Stage A — skills-project/ skill set

`skills-project/` at repo root. Deliberately separated from `skills/` (experiment skills).

- `skills-project/README.md` — layout + distinction from `skills/`.
- `skills-project/_memory-schema.md` — design doc for the two memory tables.
- `skills-project/product-context-elicitation/SKILL.md` — v0.2, two-phase intake:
  - **Phase 0 (per user, per project)**: `experience_level` (beginner / some_experience / growth_manager / data_scientist) + `featbit_flag_experience` (none / used_before). Written to `user_project_memory`, type `capability`.
  - **Phase 1 (per project, shared)**: up to 7 product questions — description, URLs, target audience, product stage, north-star metric, current focus, constraints. Written to `project_memory`.
  - **Adaptive depth table**: different tone/skip rules by experience tier. `data_scientist` only gets 4 questions; `beginner` gets all 7 with teaching.
  - Cross-tier rule: never ask methodological questions (sample size, MDE, prior choice) — those belong to `measurement-design`.
- `skills-project/project-memory-read/SKILL.md` — loads memory at session start + new substantive turn. Canonical load sequence = user `capability` + project `product_facts` + project `goals`. Other types on demand. Fail-gracefully: missing memory → degrade with a note, don't block the reply.
- `skills-project/project-memory-write/SKILL.md` — only called by other skills, not from idle chat. Provenance mandatory (`source_agent`, `created_by_user_id`). Idempotent upsert on (project_key, key) or (project_key, user_id, key).
- `skills-project/scripts/` — reference TS helpers invoking the `/api/memory` HTTP endpoints:
  - `memory-read.ts` — GET list (`--scope=project|user`, `--type=<t>?`, `--key=<k>?`)
  - `memory-write.ts` — POST upsert (supports `--content=-` for stdin)
  - `memory-delete.ts` — DELETE by key
  - Env contract: `MEMORY_API_BASE` / `FEATBIT_PROJECT_KEY` / `FEATBIT_USER_ID`

## Stage B — web memory persistence layer (done, live against Azure Postgres)

Live DB: `featbit-pg-wu3.postgres.database.azure.com / featbit-ai` (from `modules/web/.env`).

### Prisma

`modules/web/prisma/schema.prisma` gained two models:

- **`ProjectMemory`** (shared) — `(featbit_project_key, key)` unique; fields: `type`, `content`, `source_agent`, `created_by_user_id`, `editable`, timestamps. Types (app-validated): `product_facts` / `goals` / `learnings` / `constraints` / `glossary`.
- **`UserProjectMemory`** (per user per project) — `(featbit_project_key, featbit_user_id, key)` unique; no `editable` (always yes), no `created_by_user_id` (the row IS the user's). Types: `capability` / `preferences` / `decision_style` / `private_notes`.

No FK to User/Project — identities are external strings from FeatBit auth (see `modules/web/src/lib/featbit-auth/storage.ts`, `Profile.id`).

Migration: `modules/web/prisma/migrations/20260418000000_add_memory_tables/migration.sql`. Applied with `npx prisma migrate deploy`. Verified round-trip via `modules/web/scripts/smoke-memory.ts`.

### Service layer

`modules/web/src/lib/memory/`

- `types.ts` — enum constants + `isProjectMemoryType` / `isUserProjectMemoryType` type guards + upsert input interfaces.
- `project-memory.ts` — `getProjectMemory` / `getProjectMemoryEntry` / `upsertProjectMemory` / `deleteProjectMemory`
- `user-project-memory.ts` — same four operations with `userId` dim
- `index.ts` — re-exports everything

### HTTP API (Next.js route handlers)

`modules/web/src/app/api/memory/`

| Verb | Path | Action |
|---|---|---|
| GET | `/api/memory/project/:projectKey` | list (optional `?type=`) |
| POST | `/api/memory/project/:projectKey` | upsert `{key, type, content, sourceAgent?, createdByUserId?, editable?}` |
| GET | `/api/memory/project/:projectKey/:key` | single fetch |
| DELETE | `/api/memory/project/:projectKey/:key` | delete |
| GET | `/api/memory/user/:projectKey/:userId` | list (optional `?type=`) |
| POST | `/api/memory/user/:projectKey/:userId` | upsert `{key, type, content, sourceAgent?}` |
| GET | `/api/memory/user/:projectKey/:userId/:key` | single fetch |
| DELETE | `/api/memory/user/:projectKey/:userId/:key` | delete |

**No auth yet** — matches convention of other `/api/experiments/*` routes. Adds a bearer token check when we expose project-agent on a non-private network.

## Stage C — project-agent runtime (this module)

See `README.md` for layout. Key design points:

- `AGENTS.md` — always-on instructions Codex reads from the working directory.
- `src/prompt.ts` loads `./skills/*/SKILL.md`, extracts the `description` front-matter, and injects a **skills manifest** + **session-start procedure** + **ground rules** into the first user prompt. Does NOT inline skill bodies; agent reads them on demand via its Read tool.
- `src/session-store.ts` — in-memory `sessionKey → codexThreadId` map. `sessionKey` defaults to `"{projectKey}:{userId}"`. Known v1 limitation: single-instance only.
- `src/agent.ts` — lifecycle:
  1. Map Codex events (`thread.started`, `turn.*`, `item.*`, `error`) to SSE events.
  2. On `thread.started` persist `thread_id` in session store so next turn resumes.
  3. On top-level throw with a cached thread id, forget it and retry once from scratch (equivalent of sandbox's resume↔create flip).
- Codex thread options: `workingDirectory = moduleRoot`, `sandboxMode: "workspace-write"`, `networkAccessEnabled: true` (needed for /api/memory fetch), `approvalPolicy: "never"` (dev-only; revisit before prod).
- `scripts/prepare-skills.ts` — copies `skills-project/` → `./skills/` and `skills-project/scripts/memory-*.ts` → `./scripts/` at dev/build time. Physical copy (not symlink) for Windows compatibility.

Verified:
- `npm install` installs the bundled codex binary (`@openai/codex-win32-x64`).
- `npm run dev` boots server on `:3031`, prepare-skills runs first.
- `GET /healthz` → 200.
- `POST /query` with empty body → validation error SSE.
- `POST /query` with `{projectKey, userId}` → Codex thread starts (log confirms), abort on client disconnect propagates cleanly.
- `npx tsc --noEmit` clean.

**Not yet verified locally**: full Codex roundtrip — requires `OPENAI_API_KEY`. Nothing I can do about that from the session. Drop the key into `modules/project-agent/.env` and curl a bootstrap request to see events flow.

## Stage D — web UI (done)

### Sidebar

`modules/web/src/components/app-sidebar.tsx` — added `AI Memory` entry under the existing `Data` group, routing to `/data/ai-memory`. Icon: `BrainCircuit`.

### AI Memory page

`modules/web/src/app/(dashboard)/data/ai-memory/page.tsx` — thin server component that renders `<AiMemoryClient />`.

`modules/web/src/components/ai-memory/`:
- `types.ts` — entry shapes + human labels for each `type` enum value.
- `memory-entry-card.tsx` — one card per entry. Shows key, source agent tag, updated-at timestamp, read-only badge when `editable=false`, inline edit (textarea) and delete (with confirm) for editable rows.
- `ai-memory-client.tsx` — loads both scopes in parallel (`/api/memory/project/:projectKey` and `/api/memory/user/:projectKey/:userId`), groups entries by `type`, renders two sections ("Project memory (shared)" / "Your memory (private)"). Write-through on edit/delete refetches the list.

Identity model: `useAuth()` → `currentProject.key` (projectKey) + `profile.id` (userId). The page writes directly to `/api/memory/*` from the browser — matching the rest of the UI (no server-action wrapper).

### Header entry point

`modules/web/src/components/project-agent/`:
- `sse-client.ts` — POST-based SSE reader (browser `EventSource` is GET-only). Parses `event:`/`data:` pairs from a `fetch` `ReadableStream`, JSON-decodes data, yields `{event, data}` async iterator.
- `agent-chat.tsx` — chat UI hosted inside the drawer. Sends `{prompt, projectKey, userId}` to `${NEXT_PUBLIC_PROJECT_AGENT_URL}/query` (default `http://localhost:3031`). Consumes SSE; currently renders `item_completed` events where `item.type === "agent_message"` as agent bubbles, and `error` / `turn_failed` as error bubbles. Supports auto-bootstrap (empty prompt on first open).
- `agent-button.tsx` — header button wrapped in a `Sheet`. Probes `/api/memory/project/:projectKey` once when the user is ready; if zero entries, the drawer auto-sends an empty prompt on open to kick off onboarding. Shows a small brand-coloured dot on the button when auto-bootstrap is pending.

Wired into `modules/web/src/app/(dashboard)/layout.tsx` — sits to the left of `<WorkspaceSwitcher />` in the header.

### Verified

- `npx tsc --noEmit` clean across the web module.
- `npm run lint` clean for the new files (pre-existing repo-wide lint errors unchanged).
- Ran `npm run dev` (Next on :3001 because :3000 was busy):
  - `GET /data/ai-memory` → 200, compiles in ~7s, no runtime errors.
  - `GET /api/memory/project/__smoke__` → 200 `[]`.
  - `POST /api/memory/project/__smoke__` with a probe body → 200, entry persisted.
  - `GET /api/memory/project/__smoke__` → 200, returns the just-written entry.
  - `DELETE /api/memory/project/__smoke__/probe_key` → 200.

### Stage D additions (session 2)

**Azure AI Foundry support** — `.env.example` now documents both auth options:
- Option A: `OPENAI_API_KEY` (standard OpenAI)
- Option B: `AZURE_OPENAI_API_KEY` + `AZURE_OPENAI_ENDPOINT` + `OPENAI_API_VERSION` (Azure AI Foundry). No code changes needed — `buildChildEnv()` already forwards all `process.env` to the Codex subprocess; the Codex CLI's embedded OpenAI SDK reads Azure env vars natively.

**Chat UI — reasoning/command/todo rendering** (`agent-chat.tsx`):
- `reasoning` items → collapsible "Thinking…" block (dimmed, expand on click) rendered just before the agent's final response bubble.
- `command_execution` items → dark terminal-style card with command, optional output, exit code (green=0, red≠0).
- `todo_list` items → compact checklist with icons per status (`todo` = circle, `in_progress` = spinner, `done` = green checkmark with strikethrough text).
- All three are inserted before the current turn's agent bubble so arrival order is preserved.

**AI Memory — "Add entry" dialog** (`ai-memory-client.tsx`):
- Each section header now has an `+ Add` button.
- Opens a dialog with `key` (text), `type` (select from valid enum values), `content` (textarea).
- POSTs to the appropriate `/api/memory/project/:key` or `/api/memory/user/:key/:userId` endpoint with `sourceAgent: "ui-manual"`.
- `npx tsc --noEmit` clean after all changes.

### Still open in D

- `AgentChat` holds conversation state locally. Drawer close-then-reopen clears the message history in the UI even though the Codex thread persists server-side (resumed on next POST). Acceptable for v1.
- `NEXT_PUBLIC_PROJECT_AGENT_URL` needs to be set when project-agent doesn't run on `localhost:3031`.

## What is known to be missing / deferred

- **Auth on `/api/memory/*`.** v1 inherits the repo convention of no route-level auth. Add bearer-token or session check before the API is reachable from outside the dev machine.
- **Multi-instance session store.** `session-store.ts` is in-process only.
- **Docker for project-agent.** Dev-first by design; containerise after UI interaction is settled.
- **Project-agent smoke test against real Codex.** Needs `OPENAI_API_KEY`.
- **Connectors to external analytics** (GA4 / Mixpanel / PostHog / warehouse). Explicitly deferred per conversation — do not start until a customer actually asks.
- **Experiment skills consuming memory.** `intent-shaping` / `hypothesis-design` / `learning-capture` do not yet read/write `ProjectMemory`. Wire them in after Stage D stabilises.

## Key paths for quick re-orientation

```
skills-project/                             ← source of truth for project-agent skills
  product-context-elicitation/SKILL.md
  project-memory-read/SKILL.md
  project-memory-write/SKILL.md
  scripts/memory-{read,write,delete}.ts
  _memory-schema.md

modules/web/prisma/schema.prisma            ← ProjectMemory + UserProjectMemory models
modules/web/prisma/migrations/20260418000000_add_memory_tables/  ← applied
modules/web/src/lib/memory/                 ← service layer
modules/web/src/app/api/memory/             ← HTTP route handlers
modules/web/scripts/smoke-memory.ts         ← round-trip smoke test

modules/project-agent/                      ← this module
  AGENTS.md                                 ← Codex system prompt
  src/server.ts                             ← POST /query, GET /healthz
  src/agent.ts                              ← Codex SDK lifecycle + SSE
  src/prompt.ts                             ← skill loader + bootstrap builder
  scripts/prepare-skills.ts                 ← mirrors skills-project/ into ./skills
  .env.example                              ← needs OPENAI_API_KEY
```

Next session: Stage D is complete. Resume from here if working on experiment-skill memory wiring or Docker packaging.
