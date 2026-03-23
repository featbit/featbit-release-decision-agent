---
name: reversible-exposure-control
description: Makes product or AI changes reversible before they are visible, and defines who sees the change, how much traffic, and how expansion will be controlled. Activate when triggered by CF-03 or CF-04 from the release-decision framework, or when user says "feature flag", "should I ship this", "rollout strategy", "gradual rollout", "canary", "5% of users", "start exposing", "who sees this first", "create a flag", "add flag to code", or asks how to hand flag requirements to another team. Default to producing a clear implementation handoff when the current user does not own code or flag operations; FeatBit CLI and Web UI references are optional operator adapters.
license: MIT
metadata:
  author: FeatBit
  version: "1.1.0"
  category: release-management
---

# Reversible Exposure Control

This skill handles **CF-03: Reversible Change Control** and **CF-04: Exposure Strategy** from the release-decision framework.

These two control principles are handled together because they represent a single user decision intent: "I want to start showing this to users in a controlled way."

## When to Activate

- A change is about to be implemented that will affect user behavior, adoption, or outcomes
- A change exists but is not yet behind a feature flag (not reversible)
- A feature flag exists but exposure strategy is undefined or implicit
- User asks about rollout percentages, targeting, or who should see a variant
- The user owns the decision but not the codebase, the wrapper around FeatBit, or the flag operations
- `.featbit-release-decision/intent.md` shows `stage: implementing` or `stage: exposing`

## Default Operating Mode

Start by deciding which role the current user is playing.

- **Spec owner / PM / experiment owner**: they need to define the flag contract, targeting intent, rollout logic, and rollback triggers clearly enough for another team to implement. This is the default path.
- **Operator / developer**: they can create the flag, wire the SDK or wrapper, and configure rollout directly in FeatBit or another flag system.

Do not assume the current user can touch code, run vendor tooling, or change production flags.

## Decision Actions (by user intent)

### "I need to hand this feature flag requirement to the team that owns code or flags"

1. Confirm the business goal, hypothesis, and primary metric already exist
2. Define the flag contract: human-readable name, stable key, flag type, and variants
3. Define the implementation decision point: where the flag should be evaluated and what behavior changes per variant
4. Define targeting and protection rules: who sees the candidate first, who must not see it, and which user attribute controls assignment
5. Define rollout logic: initial exposure, expansion checkpoints, stop conditions, and rollback triggers
6. Define ownership and operational expectations: who creates the flag, who wires the wrapper or SDK, who approves expansion, who can disable it
7. Package the result as a handoff spec using [references/pm-dev-handoff.md](references/pm-dev-handoff.md)

### "I want to create a feature flag for this change"

Use this path only if the current user actually owns flag operations. Otherwise, switch to the handoff path above.

1. Confirm feature flag key naming (kebab-case, descriptive, environment-agnostic)
2. Define variants: baseline (control) and candidate (treatment) — if non-boolean, set up variants in the web UI first
3. Look up the environment ID: `featbit flag list <env-id>` or `featbit project get <project-id>`
4. Create the flag in the OFF state: `featbit flag create <env-id> --flag-name "..." --flag-key ...`
5. For multi-variant flags or custom variation values: use [references/tool-featbit-webui.md](references/tool-featbit-webui.md)

### "I want to start rolling this out"

1. Confirm hypothesis and primary metric exist first
2. Confirm who is protected (must NOT see the candidate)
3. Set initial exposure: default 5–10%
4. Define expansion criteria in advance — what evidence justifies moving to 25%, 50%, 100%
5. Define rollback triggers — what signals cause immediate revert
6. Read: [references/rollout-patterns.md](references/rollout-patterns.md) for strategy
7. Set rollout: `featbit flag set-rollout <env-id> <flag-key> --rollout '<json>'`
8. Enable the flag: `featbit flag toggle <env-id> <flag-key> true`
9. To rollback: `featbit flag toggle <env-id> <flag-key> false`

### "I want to target a specific audience"

1. Identify the targeting rule: user property, segment, or custom attribute
2. Confirm this audience is the right proxy for the hypothesis audience
3. If implementation is owned by another team, describe the targeting logic in the handoff spec instead of assuming direct FeatBit access
4. Set targeting rules in the FeatBit web UI before enabling the flag — see [references/tool-featbit-webui.md](references/tool-featbit-webui.md) for targeting rule setup
5. After rules are set, proceed to rollout using the CLI (see "I want to start rolling this out" above)

### "I want to add the feature flag to my code"

Use this path only if the current user can change application code. If not, create a handoff spec that names the exact insertion point and expected variant behavior.

1. Identify the language or framework in use
2. Install the FeatBit SDK skill: `npx skills add featbit/featbit-skills --skill featbit-sdks-[language]`
3. Follow the SDK skill to add the `variation()` call at the correct point in the code path
4. Use [references/tool-featbit-cli.md](references/tool-featbit-cli.md) to verify the flag key matches what is in the codebase

## Operating Rules

- Reversibility (feature flag exists) must be confirmed before exposure begins
- Never start at 100% unless protected audience targeting is explicitly intentional
- Default to a written implementation handoff when the user cannot operate the flag system or edit code directly
- Treat FeatBit CLI and Web UI as optional adapters, not the required workflow of this skill
- The important artifact is the flag contract and rollout intent; the vendor tool is secondary
- Document expansion and rollback criteria in `.featbit-release-decision/intent.md` under `constraints:`
- Hand off to `measurement-design` if instrumentation is not confirmed before exposure begins
- Update `stage: exposing` in `.featbit-release-decision/intent.md` when exposure begins

## Reference Files

- [references/rollout-patterns.md](references/rollout-patterns.md) — vendor-agnostic rollout strategy, progressive exposure, protected audience guidance
- [references/pm-dev-handoff.md](references/pm-dev-handoff.md) — PM or experiment owner handoff template for the team that owns code, wrappers, and flag operations
- [references/tool-featbit-cli.md](references/tool-featbit-cli.md) — FeatBit CLI: config, inspect, flag create/toggle/archive/set-rollout/evaluate, SDK integration via featbit-skills
- [references/tool-featbit-webui.md](references/tool-featbit-webui.md) — FeatBit web UI: targeting rules, multi-variant setup, audit trail, RBAC management
