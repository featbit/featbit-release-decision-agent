---
name: project-memory-read
description: Load project-scoped and user-scoped memory so the agent can ground every turn in facts it has already captured. Activate at session start, at the top of any new user turn that isn't a pure continuation, and whenever another skill explicitly needs to check what is already known before asking a question. Do not re-read within a single turn — cache the result in the session for the current reply.
license: Apache-2.0
metadata:
  author: FeatBit
  version: "0.1.0"
  category: project-onboarding
---

# Project Memory Read

Grounding skill. Every other project-agent skill (and eventually every experiment skill) depends on this one to know what is already on file. Without it, the agent re-asks, contradicts itself, or makes suggestions that ignore the user's prior answers.

## Execution Procedure

```python
def read_memory(scope: str, type: str = None, key: str = None) -> list:
    cmd = f"npx tsx scripts/memory-read.ts --scope={scope}"
    if type: cmd += f" --type={type}"
    if key:  cmd += f" --key={key}"
    return json.loads(run(cmd).stdout)  # [] if empty, exits non-zero on HTTP error

def load_session_context(project_key: str, user_id: str = None) -> dict:
    product = read_memory("project", type="product_facts")
    goals   = read_memory("project", type="goals")
    caps    = read_memory("user", type="capability") if user_id else []
    brief   = build_context_brief(product, goals, caps)  # see Building the Context Brief
    # Constraints, learnings, glossary: loaded on demand by the skill that needs them
    return brief

def build_context_brief(product: list, goals: list, caps: list) -> dict:
    tier = first(caps, key="experience_level")
    if not tier or not first(product, key="product_description"):
        Skill("product-context-elicitation").ok  # missing critical entries — run onboarding
    return {
        "tier": tier,
        "product": {e["key"]: e["content"] for e in product},
        "goals":   {e["key"]: e["content"] for e in goals},
    }
```

## When to Activate

- **Session start.** Before the agent's first reply, load all relevant memory.
- **Top of a new turn** when the user's message isn't a trivial acknowledgement ("ok", "thanks"). A substantive user turn may reference something on file — check before replying.
- **On request from another skill.** `product-context-elicitation` reads before asking any question. `intent-shaping` / `hypothesis-design` (experiment skills, eventually) read before framing their prompts. The caller should state which scope and type it needs; read exactly that, not more.

Do **not** re-read within a single agent turn. Cache the result in session state for the duration of the reply. Memory does not change mid-turn unless this agent wrote it.

## Inputs the Runtime Provides

The agent process is started with these environment variables bound to the current session:

- `FEATBIT_PROJECT_KEY` — current project
- `FEATBIT_USER_ID` — current user (may be absent for background / system sessions)
- `MEMORY_API_BASE` — base URL of the web app's memory API

Never take these from conversation — only from the environment. If `FEATBIT_USER_ID` is missing, skip user-scope reads silently.

## Read Operations

All operations go through the helper scripts. The agent must **not** compose raw URLs or talk to Prisma.

### List project-scoped entries

```bash
npx tsx scripts/memory-read.ts --scope=project
npx tsx scripts/memory-read.ts --scope=project --type=product_facts
npx tsx scripts/memory-read.ts --scope=project --type=goals
npx tsx scripts/memory-read.ts --scope=project --type=learnings
npx tsx scripts/memory-read.ts --scope=project --type=constraints
npx tsx scripts/memory-read.ts --scope=project --type=glossary
```

### List user-scoped entries

```bash
npx tsx scripts/memory-read.ts --scope=user
npx tsx scripts/memory-read.ts --scope=user --type=capability
npx tsx scripts/memory-read.ts --scope=user --type=preferences
npx tsx scripts/memory-read.ts --scope=user --type=decision_style
npx tsx scripts/memory-read.ts --scope=user --type=private_notes
```

### Single-entry fetch

```bash
npx tsx scripts/memory-read.ts --scope=project --key=product_description
npx tsx scripts/memory-read.ts --scope=user    --key=experience_level
```

Each call prints a JSON array (or a single object for `--key=`) to stdout. An empty array means the scope is empty — not an error.

## Canonical Load Sequence at Session Start

Run these three reads in parallel (or sequentially if the runtime can't parallelize), then build a **context brief** for the system prompt:

```bash
npx tsx scripts/memory-read.ts --scope=user    --type=capability       # experience + flag history
npx tsx scripts/memory-read.ts --scope=project --type=product_facts    # product description, audience, stage
npx tsx scripts/memory-read.ts --scope=project --type=goals            # north star + current focus
```

`constraints`, `learnings`, `glossary`, and other types are loaded **on demand** by the skills that need them, not up-front. Loading everything pollutes the context window.

## Building the Context Brief

After loading, the agent should summarise what it has into a compact block injected at the top of its reasoning, not read raw to the user. A good brief:

- Names the user's experience tier so every reply that follows is tuned correctly.
- Lists the product facts in one line each.
- States the current focus so the agent doesn't drift into topics the user didn't ask about.
- **Omits** entries that aren't relevant to this turn — don't dump `learnings` unless the turn is about past results.

If critical entries are missing (no `product_description`, or no `experience_level`), hand off to `product-context-elicitation` instead of guessing.

## Failure Handling

- **HTTP 5xx or network error.** Degrade gracefully — proceed with a one-line note "(memory unavailable this turn)" in the internal brief, and do not guess stored values. Do not block the reply.
- **HTTP 404 on single-entry fetch.** Treat as "entry does not exist yet." Not an error.
- **Missing env vars.** If `FEATBIT_PROJECT_KEY` is absent, abort with a clear error — the agent cannot function without it. If only `FEATBIT_USER_ID` is missing, skip user-scope reads and continue.

## Anti-patterns

- Reading memory, then asking the user a question the memory already answered.
- Reading every type "just in case." Load by scope and type — the API supports it for a reason.
- Reading memory inside a single turn's reasoning loop more than once. Cache.
- Reading memory and then paraphrasing every entry back to the user. The brief is for the agent, not the user — surface entries only when the reply legitimately needs them.
