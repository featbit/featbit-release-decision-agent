---
name: product-context-elicitation
description: Two-phase first-run intake. Phase 0 calibrates the user (experience level + prior FeatBit flag usage) so the agent knows how to talk to them. Phase 1 asks up to seven high-value product questions, modulated by the calibrated experience tier. Activate on first login, on first project creation, when a new user joins a project with empty user-scope memory, or when project memory is missing the canonical product_facts entries. Do not re-run Phase 1 when those entries already exist unless the user explicitly asks to redo onboarding.
license: MIT
metadata:
  author: FeatBit
  version: "0.2.0"
  category: project-onboarding
---

# Product Context Elicitation

This skill is how **project-agent** earns the right to give useful suggestions later. Without grounded product context, every downstream hypothesis and experiment recommendation is guessing.

Its job is to elicit a compact, semantically meaningful picture of the user's product and project — and persist it into **project memory** so it is available to every subsequent conversation, every experiment skill, and every future user on the same project.

## Execution Procedure

```python
def run_elicitation(project_key: str, user_id: str):
    # On Entry: load current state via project-memory-read
    caps  = Skill("project-memory-read", "--scope=user --type=capability")
    facts = Skill("project-memory-read", "--scope=project --type=product_facts")
    goals = Skill("project-memory-read", "--scope=project --type=goals")

    phase0_done = has_keys(caps,  ["experience_level", "featbit_flag_experience"])
    phase1_done = has_keys(facts, ["product_description", "target_audience", "north_star_metric"])

    if not phase0_done:
        run_phase0(project_key, user_id)
        caps = Skill("project-memory-read", "--scope=user --type=capability")

    if not phase1_done:
        tier = caps.get("experience_level", "some_experience")
        run_phase1(project_key, user_id, tier)

    complete(project_key, user_id, tier=caps.get("experience_level", "some_experience"))

def run_phase0(project_key: str, user_id: str):
    tier     = ask_experience_level()    # see Phase 0 — Calibration: 0a
    flag_exp = ask_flag_experience()     # see Phase 0 — Calibration: 0b
    Skill("project-memory-write", f'--scope=user --key=experience_level --type=capability --content="{tier}" --source-agent=project-agent')
    Skill("project-memory-write", f'--scope=user --key=featbit_flag_experience --type=capability --content="{flag_exp}" --source-agent=project-agent')

def run_phase1(project_key: str, user_id: str, tier: str):
    questions = adaptive_questions(tier)  # see Adaptive Depth section for skipping rules
    for q in questions:
        answer = ask_one(q.prompt)
        reflect_and_confirm(answer)       # paraphrase + wait for confirmation
        Skill("project-memory-write", f'--scope=project --key={q.key} --type={q.type} --content="{answer}" --source-agent=project-agent --created-by={user_id}')

def complete(project_key: str, user_id: str, tier: str):
    Skill("project-memory-write", f'--scope=project --key=onboarding_completed_at --type=product_facts --content="{now()}" --source-agent=project-agent --created-by={user_id}')
    post_summary(tier)  # see Completion Handoff
    if user_came_for_experiment_help():
        Skill("intent-shaping").ok
```

## When to Activate

The skill has **two phases** with independent activation conditions. Always check Phase 0 first.

### Phase 0 — User calibration (per user, per project)

Activate when:

- `user_project_memory` for this `(projectKey, userId)` does **not** contain an `experience_level` entry, **or** it does not contain a `featbit_flag_experience` entry.

Phase 0 runs even when Phase 1 is already complete — a new collaborator joining an existing project needs calibration even though the product facts are on file.

### Phase 1 — Product context (per project, shared)

Activate when **any** of these is true:

- First login for a user who has no FeatBit project selected yet, and the project they are about to create is new.
- A FeatBit project has just been created and has no `project_memory` rows with `type = "product_facts"`.
- The user explicitly says "help me set this up", "onboard me", "let's start fresh", or clicks the onboarding entry point.
- `product_description` is missing from project memory but the user is asking for experiment guidance — run a compressed version first, then hand off.

Do **not** activate Phase 1 when:

- `project_memory` already contains `product_description`, `target_audience`, and `north_star_metric` entries **and** the user did not ask to redo intake. Instead, surface a one-line summary of what is on file and ask only if something has changed.
- The user is mid-experiment and asked an operational question. Interrupting with intake is hostile.

## Operating Principles

1. **Ask few, ask well.** Five to seven questions, hard ceiling. Every question must map to an entry the agent will actually use downstream.
2. **One question at a time.** Do not dump a form. The conversational shape is what makes the user willing to answer at all.
3. **Reflect, then write.** After each answer, paraphrase what you heard in one line and ask for confirmation before writing to memory. Users catch misunderstandings when they see their words reflected back.
4. **Accept "I don't know" and skip.** Write a `"(not provided)"` entry so the agent later knows the question was asked and declined, not forgotten.
5. **Never ask the same question twice across sessions.** Read existing project memory on entry and skip anything already answered.

## On Entry — Read Current State

Before asking anything, load both memory stores via `project-memory-read`:

```bash
# Invoked as Skill("project-memory-read", "--scope=user --type=capability")
# Invoked as Skill("project-memory-read", "--scope=project --type=product_facts")
# Invoked as Skill("project-memory-read", "--scope=project --type=goals")
```

Build two checklists — one for Phase 0 calibration keys (`experience_level`, `featbit_flag_experience`), one for Phase 1 canonical product keys. Ask only what is missing from each. If Phase 0 entries exist, load them before asking Phase 1 questions so tone and depth are calibrated from turn one.

## Phase 0 — Calibration (two questions, always first when missing)

### 0a. Experience level
> "Before we dig in, how would you describe your experience with A/B testing and experimentation?"
>
> 1. Just starting out — would like to learn the basics as we go
> 2. Have run a few tests but wouldn't call myself an expert
> 3. Growth manager / PM with solid experimentation experience
> 4. Data scientist / statistician, deep in the methodology

Offer the numbered options verbatim. Accept a free-text answer and map it to the closest tier. If the user's answer is ambiguous, ask one clarifying follow-up — don't guess.

Writes:
```
upsertUserProjectMemory(projectKey, userId, {
  key:     "experience_level",
  type:    "capability",
  content: "beginner" | "some_experience" | "growth_manager" | "data_scientist",
  sourceAgent: "project-agent",
})
```

### 0b. FeatBit flag usage history
> "Have you used FeatBit's feature flags before — creating flags, splitting traffic, rolling out gradually?"
>
> - **Not yet** — this is new to me
> - **Yes, I've used flags** — (optionally: on which projects / how recently)

This matters because later experiment skills will need to decide whether to *teach* flag creation or *invoke* it, and whether the user can self-serve a traffic-split rollout or needs a handoff package for another team.

Writes:
```
upsertUserProjectMemory(projectKey, userId, {
  key:     "featbit_flag_experience",
  type:    "capability",
  content: "none" | "used_before: <optional details>",
  sourceAgent: "project-agent",
})
```

When this is `none`, every downstream skill that would normally say "create a flag with these settings" should instead prepare a short teaching moment or a handoff artifact. This contract lives in `reversible-exposure-control`'s handoff mode — nothing for Phase 0 to do beyond writing the value.

## Adaptive Depth — How Phase 1 Is Modulated by Experience Level

After Phase 0, load `experience_level` and apply these rules to every Phase 1 question. If you must compress, compress in this order: Q7 → Q4 → Q2. Never skip Q1, Q3, Q5, Q6.

| Tier | Style | Full 7 questions? | Explanations |
|---|---|---|---|
| `beginner` | Teach while asking. Define terms in one sentence when introduced (hypothesis, primary metric, guardrail). Offer examples tied to common product types. | Yes — all 7. | Rich. After each answer, briefly state *why* this fact will matter downstream. |
| `some_experience` | Conversational, light definitions only when a term is used. | Yes — all 7. | Minimal. Reflect each answer back; do not lecture. |
| `growth_manager` | Terse, peer-to-peer. Use the vocabulary freely (statistical power, guardrail, MDE) without defining. | Can skip Q7; merge Q2 into Q1 if the URL is obvious from context. | None. Assume shared vocabulary. |
| `data_scientist` | Minimal scaffolding. State the goal of intake in one line, then ask only Q1, Q3, Q5, Q6. | No — 4 questions. | None. Let them drive. Surface the AI Memory page immediately after so they can fill the rest themselves if they want. |

One universal rule across tiers: **never ask a methodological question during intake**. Do not ask "what sample size are you targeting", "do you want frequentist or Bayesian", "what's your MDE". Those belong to `measurement-design`, not here. This holds even for `data_scientist` — especially for them, because respecting scope is what earns trust.

## The Seven Canonical Questions (Phase 1)

Ask in this order. Order matters — each later answer is easier after the earlier ones are on the table. Apply the **Adaptive Depth** rules above when deciding which to skip and how much to explain.

### 1. Product description — what is it?
> "In one sentence, what is [product name]? If a new teammate joined tomorrow, what would you tell them?"

Writes: `product_facts` / key `product_description`.

### 2. Product URL — where does it live?
> "What's the URL (or URLs) of the main product surface? Web app, marketing site, or both?"

Writes: `product_facts` / key `product_urls`. Accepts a list.

### 3. Target audience — who is it for?
> "Who is the primary user? Be specific — 'SMB marketing teams doing their first paid campaigns' is more useful than 'marketers'."

Writes: `product_facts` / key `target_audience`.

### 4. Current stage — what kind of product is it right now?
> "Is this pre-product-market-fit, finding PMF, scaling a proven motion, or optimizing a mature product?"

Writes: `product_facts` / key `product_stage`. This single answer tunes the agent's entire recommendation style — a PMF-stage team should rarely be running traffic-allocation A/B tests; a scaling team probably should.

### 5. North-star metric — what ultimately matters?
> "If you could only watch one metric to know whether [product] is winning, what would it be?"

Writes: `goals` / key `north_star_metric`. If the user names a vanity metric (page views, signups), gently probe once: "And that matters because it leads to what?"

### 6. Current top concern — what's on fire right now?
> "What's the thing you most want to move in the next few weeks? A metric, a funnel step, a specific user behavior?"

Writes: `goals` / key `current_focus`. This is the input most likely to change between sessions — re-confirm it if older than 30 days.

### 7. Constraints the agent should respect
> "Anything I should know that would make a suggestion a non-starter? Compliance, platform constraints, team bandwidth, timing?"

Writes: `constraints` / key `known_constraints`. Optional — skip if the user seems impatient, come back to it later.

## Write Protocol

All writes go through `Skill("project-memory-write", ...)`. Never write directly — provenance fields are mandatory.

**Phase 0 writes go to user-scoped memory** (each user calibrates themselves, even when sharing a project):

```bash
# Skill("project-memory-write", '--scope=user --key=experience_level --type=capability --content="<tier>" --source-agent=project-agent')
# Skill("project-memory-write", '--scope=user --key=featbit_flag_experience --type=capability --content="<value>" --source-agent=project-agent')
```

**Phase 1 writes go to project-scoped memory** (product facts are shared across all collaborators on the project):

```bash
# Skill("project-memory-write", '--scope=project --key=<key> --type=<type> --content="<answer>" --source-agent=project-agent --created-by=<user_id>')
```

Do not batch writes to the end. Write after each confirmed answer so a user who abandons halfway still has their first few answers persisted.

## Completion Handoff

When Phase 0 is complete **and** Phase 1 is either complete or explicitly skipped per the adaptive-depth rules:

1. Post a single summary message tuned to the calibrated tier. For `beginner` include a one-line orientation to what happens next ("From here, when you want to run an experiment, I'll help you sharpen the goal first"); for `data_scientist` keep it to the file listing.
2. Surface the `Data → AI Memory` link once, then get out of the way.
3. If the user originally came in asking for experiment help, **now** hand off to the relevant experiment skill (`intent-shaping` is almost always the right next step).
4. Write one final entry: `onboarding_completed_at` (type `product_facts`) — downstream skills use this as a signal that context is grounded.

## Anti-patterns

- Asking about tooling, tech stack, or analytics platforms during intake. Those are implementation details; elicit them only when a specific experiment needs them.
- Writing a `learnings`-type entry during onboarding. Learnings come from completed experiments, not from initial self-report.
- Re-running the full seven-question flow when the user asks a one-off question. If only one canonical entry is missing, ask only that one.
- Re-running Phase 0 for a user whose calibration is already on file. If their experience seems to have changed (e.g. a beginner is now using advanced vocabulary), ask a single one-line confirmation rather than the full two-question flow.
- Asking methodological questions (sample size, prior choice, MDE) during intake regardless of tier — those belong to `measurement-design`.
- Treating this as a form. It is a conversation that happens to produce structured output.
