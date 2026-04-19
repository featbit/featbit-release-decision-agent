# Memory schema — draft

Status: **draft, not migrated**. This document describes the tables that should be added to `modules/web/prisma/schema.prisma` to back project-agent's memory. Review before running the migration.

## Why two tables

A FeatBit project is shared by multiple users. Memory therefore has two distinct scopes and they must not be conflated:

| Scope | Shared by | Example entries |
|---|---|---|
| **project** | all users of the FeatBit project | product description, target audience, north-star metric, captured learnings from finished experiments |
| **user-project** | one user, within one project | this user's decision style, risk tolerance, notification preferences |

Two tables is clearer than a single polymorphic table because the access-control rules diverge:

- **ProjectMemory**: any user of the project can read; writes are audited with `created_by_user_id` but the entry is shared.
- **UserProjectMemory**: only the owning user can read or write. A second user in the same project never sees another user's entries.

## Identity model

The web module does not persist its own `User` or `Project` tables — authentication is delegated to the FeatBit backend (see `modules/web/src/lib/featbit-auth/`). Memory rows therefore use **external string identifiers**:

- `featbit_project_key` — the FeatBit project key (already used in `experiment.featbit_project_key`).
- `featbit_user_id` — comes from the FeatBit auth profile (`Profile.id` in `modules/web/src/lib/featbit-auth/storage.ts`).

No foreign-key constraints to non-existent local tables. Index on the scope columns so lookups stay fast.

## Proposed Prisma models

```prisma
model ProjectMemory {
  id                String   @id @default(uuid())
  featbitProjectKey String   @map("featbit_project_key")

  // Slug that identifies the entry within the project, e.g. "product_description",
  // "target_audience", "north_star_metric". Unique per project so upserts are cheap.
  key               String

  // Broad category. Enumerated values are validated in application code, not at
  // the DB level, so we can iterate without migrations.
  //   "product_facts"   — objective product info (what it is, who uses it, URL, stack)
  //   "goals"           — business goals and target metrics at project level
  //   "learnings"       — sedimented findings from finished experiments
  //   "constraints"     — compliance, platform, team constraints
  //   "glossary"        — domain terms the agent should use consistently
  type              String

  content           String   // markdown or plain text; agents format on read

  // Provenance. `source_agent` is the agent that wrote the entry (e.g. "project-agent",
  // "learning-capture"). `created_by_user_id` is the FeatBit user who was in session
  // when the agent wrote — important for audit even though the entry is shared.
  sourceAgent       String?  @map("source_agent")
  createdByUserId   String?  @map("created_by_user_id")

  // Whether the web UI should allow editing. Onboarding facts are editable; a
  // statistically-derived learning written by an analysis agent may not be.
  editable          Boolean  @default(true)

  createdAt         DateTime @default(now()) @map("created_at")
  updatedAt         DateTime @updatedAt @map("updated_at")

  @@unique([featbitProjectKey, key])
  @@index([featbitProjectKey, type])
  @@map("project_memory")
}

model UserProjectMemory {
  id                String   @id @default(uuid())
  featbitProjectKey String   @map("featbit_project_key")
  featbitUserId     String   @map("featbit_user_id")

  key               String
  // Types for user scope:
  //   "capability"      — experience level, prior tooling usage (drives how the agent talks to this user)
  //   "preferences"     — UI/interaction preferences
  //   "decision_style"  — risk tolerance, evidence thresholds
  //   "private_notes"   — user's own notes about the project
  type              String

  content           String

  sourceAgent       String?  @map("source_agent")

  createdAt         DateTime @default(now()) @map("created_at")
  updatedAt         DateTime @updatedAt @map("updated_at")

  @@unique([featbitProjectKey, featbitUserId, key])
  @@index([featbitProjectKey, featbitUserId, type])
  @@map("user_project_memory")
}
```

## Read/write paths

Three consumers of this data must be kept in mind from day one:

1. **project-agent** (writer + reader) — writes during onboarding, reads before every user turn to ground responses.
2. **Web UI `data > AI Memory` page** (reader + editor) — renders entries grouped by type, supports inline edit and delete for `editable=true` rows.
3. **Experiment skills** (reader, later) — `intent-shaping`, `hypothesis-design`, `learning-capture` will pull `project_memory` rows when forming hypotheses and write back a `learnings`-type row when an experiment closes.

A thin service layer (`modules/web/src/lib/memory/`) should expose:

```
getProjectMemory(projectKey, { type? })
upsertProjectMemory(projectKey, { key, type, content, ... })
deleteProjectMemory(projectKey, key)

getUserProjectMemory(projectKey, userId, { type? })
upsertUserProjectMemory(projectKey, userId, { key, type, content, ... })
deleteUserProjectMemory(projectKey, userId, key)
```

project-agent reaches this layer via the same HTTP surface the web app uses (or a dedicated agent-facing endpoint with token auth), never directly against the DB — this keeps the agent runtime-agnostic and avoids coupling the agent container to the Prisma client.

## Deliberate non-goals (for v1)

- **No embeddings / vector search.** Entry counts per project will be small (tens, not thousands). A `SELECT ... WHERE project_key = ? AND type = ?` is enough. Add pgvector later only when list-all-and-let-the-agent-filter stops working.
- **No soft delete / history.** `updatedAt` is sufficient traceability; we can add an `event` audit table later if users start asking "when did this change?".
- **No environment scoping.** Product facts don't vary by env. If a future case genuinely needs env-scoped memory (unlikely), add a nullable `featbit_env_id` to `ProjectMemory` at that time.

## Open questions before migrating

1. Should `created_by_user_id` on `ProjectMemory` be NOT NULL once we plumb it through? Current setup allows agents without user context to write (e.g. a scheduled job) — worth keeping nullable.
2. Does `editable=false` also hide the row from the agent's editable set, or only from the UI? (Assumption for now: only the UI — the agent can always overwrite with a new `sourceAgent`.)
3. When a FeatBit project is deleted upstream, who cleans up these rows? No FK cascade is possible. Options: a periodic reconciler, or accept orphans.
