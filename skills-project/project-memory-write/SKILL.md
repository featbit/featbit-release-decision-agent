---
name: project-memory-write
description: Upsert or delete a single memory entry — project-scoped (shared across users of the project) or user-scoped (private to one user in this project). Activate only when called from another skill that has a clear reason to persist a specific fact. Do not call speculatively from general conversation. Every write carries provenance (source_agent, created_by_user_id) so the origin of every entry is auditable.
license: MIT
metadata:
  author: FeatBit
  version: "0.1.0"
  category: project-onboarding
---

# Project Memory Write

Writing skill. This is how project-agent turns a conversation into durable state. Every write is a commitment the agent makes on behalf of the user; therefore every write must be (a) explicitly sourced from a confirmed user answer or a deterministic computation, and (b) traceable via provenance fields.

## Execution Procedure

```python
def upsert(scope: str, key: str, type: str, content: str,
           source_agent: str, created_by: str = None, editable: bool = True):
    assert scope in ("project", "user")
    cmd = (f"npx tsx scripts/memory-write.ts --scope={scope} --key={key} "
           f"--type={type} --source-agent={source_agent}")
    cmd += f' --content="{content}"'  # use --content=- for multi-line stdin
    if scope == "project" and created_by:
        cmd += f" --created-by={created_by}"
    if not editable:
        cmd += " --editable=false"
    assert run(cmd).exit_code == 0  # HTTP 400 = programming error, do not retry

def delete(scope: str, key: str):
    assert run(f"npx tsx scripts/memory-delete.ts --scope={scope} --key={key}").exit_code == 0
```

## When to Activate

Called by other skills, not by the user directly. The skill is invoked when:

- `product-context-elicitation` has a confirmed answer to a canonical question (Phase 0 or Phase 1).
- A future experiment skill (`learning-capture`) closes an experiment and needs to write a `learnings` entry.
- The web UI's `Data → AI Memory` page proxies a user edit — but the UI should call the API directly, not this skill, since there is no agent reasoning involved.

Do **not** activate this skill:

- From idle conversation ("nice weather today") — there is nothing to write.
- To mirror something the user said that is not on a canonical key. If the fact doesn't have a defined key, it belongs in a future `private_notes` entry or nowhere.
- To "save progress" speculatively. Writes are confirmed facts, not conversation drafts.

## Inputs the Runtime Provides

Same environment as `project-memory-read`:

- `FEATBIT_PROJECT_KEY`, `FEATBIT_USER_ID`, `MEMORY_API_BASE`

## Write Operations

### Project-scoped upsert

```bash
npx tsx scripts/memory-write.ts \
  --scope=project \
  --key=product_description \
  --type=product_facts \
  --content="Short sentence describing the product." \
  --source-agent=project-agent \
  --created-by=$FEATBIT_USER_ID
```

- `--key` — canonical entry slug. Reuse keys defined by the calling skill; do not invent new ones ad hoc.
- `--type` — one of `product_facts`, `goals`, `learnings`, `constraints`, `glossary`.
- `--content` — the fact itself. Use `--content=-` to read from stdin for multi-line values.
- `--source-agent` — **required in practice.** The agent that performed the write. For project-agent, use `project-agent`. For experiment agents, use their own name (`learning-capture`, etc.). This field is how we track down bad writes later.
- `--created-by` — the FeatBit user id in session. Pass it through even for shared entries; it is for audit, not access control.
- `--editable=false` — use only for entries that must not be overridden by the UI (e.g. a statistically computed learning). Defaults to true.

### User-scoped upsert

```bash
npx tsx scripts/memory-write.ts \
  --scope=user \
  --key=experience_level \
  --type=capability \
  --content=beginner \
  --source-agent=project-agent
```

`--type` is one of `capability`, `preferences`, `decision_style`, `private_notes`.

### Delete

```bash
npx tsx scripts/memory-delete.ts --scope=project --key=product_description
npx tsx scripts/memory-delete.ts --scope=user    --key=experience_level
```

## Confirmation Discipline

Before calling this skill, the calling skill must have obtained an explicit user confirmation for the content being written. The agent should at minimum reflect the value back:

> "Got it — 'FeatBit helps teams do safe feature rollouts.' Saving that as the product description. Say so if that's off."

Then write. For high-cost edits (e.g. overwriting an existing `learnings` entry), require an explicit affirmative — don't proceed on silence.

## Provenance Rules

- `source_agent` is **mandatory** for agent-originated writes. A write without a source agent is a bug; the downstream audit has no way to find its origin.
- `created_by_user_id` is mandatory for project-scoped writes when a user is in session. It is allowed to be null when an automated job (scheduled learning digest, etc.) performs the write.
- The API layer does not enforce these rules — it trusts the skill. This is a soft contract that the skills honor; breaking it silently corrupts the audit trail.

## Idempotency

Upsert is idempotent on `(project_key, key)` for project scope and `(project_key, user_id, key)` for user scope. Calling the same write twice is safe. Use this to your advantage: if you're not sure whether a write succeeded, just call it again rather than trying to diff.

## Failure Handling

- **HTTP 400 (validation error).** The `type` or payload shape was wrong. Log the error and abort the turn — do not retry blindly. These are programming errors, not transient failures.
- **HTTP 5xx or network error.** Retry once after a short delay. If the retry fails, surface a terse apology to the user ("couldn't save that just now; I'll ask again next turn") and stop — do not pretend it worked.
- **Missing env vars.** Abort with a clear error. The skill cannot function without `FEATBIT_PROJECT_KEY`, and user-scope writes cannot function without `FEATBIT_USER_ID`.

## Anti-patterns

- Batching all writes from a long intake to the end of the session. Write after each confirmed answer — partial persistence is better than all-or-nothing loss on abandonment.
- Writing without `source_agent`. This destroys the audit trail.
- Writing the user's verbatim answer when a light normalization is obvious (trimming, collapsing whitespace, mapping "beginner"/"newbie"/"starter" to `beginner`). The calling skill should normalize; this skill just persists.
- Writing project-scoped when the fact is really user-specific (someone's personal risk tolerance), or vice versa (the product's URL). Scope mistakes are extremely hard to correct later — get this right at the call site.
- Treating write failure as success. If the script exits non-zero, the write did not happen.
