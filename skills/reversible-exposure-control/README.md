# reversible-exposure-control

This skill handles making changes reversible before they are visible (CF-03) and defining who sees the change and how traffic expands (CF-04).

---

## File Map

Every file in this skill belongs to one of three tiers. Before touching any file, check which tier it is in.

### Tier 1 — System-defined 🔒 Do not modify

The framework's core principles for exposure control. These define the *reasoning* the agent uses regardless of which vendor you use.

| File | Purpose |
|------|---------|
| `SKILL.md` | Agent instructions — CF-03/CF-04 decision logic, rollout reasoning, rollback triggers |
| `references/rollout-patterns.md` | Canonical rollout strategies — conservative start, protected audiences, expansion criteria |

### Tier 2 — Practice defaults 📋 Replace or extend for your stack

These files implement FeatBit as the default feature flag vendor and the default PM-to-Dev handoff shape. If your team uses a different vendor (LaunchDarkly, Unleash, Flagsmith, custom) or a custom wrapper around FeatBit, **replace or extend the relevant file(s) and update `SKILL.md` to reference them**.

| File | Default | What to replace it with |
|------|---------|------------------------|
| `references/pm-dev-handoff.md` | PM / experiment owner handoff contract for the team that owns code and flags | Your team's implementation spec template, ticket template, or engineering handoff checklist |
| `references/tool-featbit-cli.md` | FeatBit CLI — flag creation, toggle, rollout in pipelines | Your vendor's CLI reference, e.g. `tool-launchdarkly-cli.md` |
| `references/tool-featbit-webui.md` | FeatBit Web UI — multi-variant setup, targeting rules | Your vendor's UI guide or API reference |

> If your implementation team uses an internal wrapper around FeatBit, keep the rollout principles but rewrite `references/pm-dev-handoff.md` to describe the wrapper contract and local engineering expectations instead of raw FeatBit operations.

> If you switch vendors, replace both `tool-featbit-*.md` files and update the **Decision Actions** section in `SKILL.md` to use the new tool's commands. The rollout *principles* in `rollout-patterns.md` stay the same regardless of vendor.

### Tier 3 — User-defined ✏️ You create and own these

These are the actual flags and targeting rules that live in your project. The agent helps you create them using the Tier 2 tools, but the values and strategy are yours.

| Artifact (in your system) | Purpose | Who creates it |
|---------------------------|---------|----------------|
| Implementation handoff spec / ticket | Explains the flag contract, rollout plan, and rollback rules to the team that owns code and flag operations | PM, experiment owner, or agent |
| Feature flag in FeatBit (or your vendor) | The reversibility gate for your change | Agent issues CLI commands or guides Web UI steps |
| Rollout percentage and targeting rules | Who sees the candidate variant and how much | You decide; agent proposes based on `rollout-patterns.md` |
| Expansion and rollback criteria | What evidence triggers moving forward or reverting | You define; agent prompts you to make it explicit |

---

## How customization works

The handoff template and vendor-specific files are adapters. The underlying exposure logic in `rollout-patterns.md` and `SKILL.md` does not change when you swap vendors or use an internal wrapper — only the implementation contract changes.

Typical swap:

1. Add or update `references/pm-dev-handoff.md` so it matches how your engineering team wants rollout requests described
2. Add `references/tool-<your-vendor>.md` with the equivalent commands for flag create, toggle, set-rollout, and target if direct operator guidance is still useful
3. Update **Decision Actions** in `SKILL.md` to reference your handoff file and any new tool file instead of the FeatBit references
4. Keep `rollout-patterns.md` and the CF-03/CF-04 reasoning in `SKILL.md` untouched

---

## Extending this skill

If you add a new rollout pattern (e.g. a canary-by-region strategy or a time-based ramp):

1. Add the pattern to `references/rollout-patterns.md` under a new section
2. If it requires a new decision action, add it to `SKILL.md`

If you add a second vendor (running two flag systems in parallel):

1. Add `references/tool-<vendor-b>.md`
2. Update `SKILL.md` → **Reference Files** section
3. Note in `SKILL.md` under which conditions each vendor is used
