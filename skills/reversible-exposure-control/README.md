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

These files implement FeatBit as the default feature flag vendor. If your team uses a different vendor (LaunchDarkly, Unleash, Flagsmith, custom), **replace the relevant file(s) and update `SKILL.md` to reference them**.

| File | Default | What to replace it with |
|------|---------|------------------------|
| `references/tool-featbit-cli.md` | FeatBit CLI — flag creation, toggle, rollout in pipelines | Your vendor's CLI reference, e.g. `tool-launchdarkly-cli.md` |
| `references/tool-featbit-webui.md` | FeatBit Web UI — multi-variant setup, targeting rules | Your vendor's UI guide or API reference |

> If you switch vendors, replace both `tool-featbit-*.md` files and update the **Decision Actions** section in `SKILL.md` to use the new tool's commands. The rollout *principles* in `rollout-patterns.md` stay the same regardless of vendor.

### Tier 3 — User-defined ✏️ You create and own these

These are the actual flags and targeting rules that live in your project. The agent helps you create them using the Tier 2 tools, but the values and strategy are yours.

| Artifact (in your system) | Purpose | Who creates it |
|---------------------------|---------|----------------|
| Feature flag in FeatBit (or your vendor) | The reversibility gate for your change | Agent issues CLI commands or guides Web UI steps |
| `.featbit-release-decision/intent.md` → `stage: exposing` | Records that exposure is active | Agent updates |
| Rollout percentage and targeting rules | Who sees the candidate variant and how much | You decide; agent proposes based on `rollout-patterns.md` |
| Expansion and rollback criteria | What evidence triggers moving forward or reverting | You define; agent prompts you to make it explicit |

---

## How customization works

The vendor-specific files (`tool-featbit-*.md`) are adapters. The underlying exposure logic in `rollout-patterns.md` and `SKILL.md` does not change when you swap vendors — only the commands change.

Typical swap:

1. Add `references/tool-<your-vendor>.md` with the equivalent commands for flag create, toggle, set-rollout, and target
2. Update **Decision Actions** in `SKILL.md` to reference your new tool file instead of the FeatBit references
3. Keep `rollout-patterns.md` and the CF-03/CF-04 reasoning in `SKILL.md` untouched

---

## Extending this skill

If you add a new rollout pattern (e.g. a canary-by-region strategy or a time-based ramp):

1. Add the pattern to `references/rollout-patterns.md` under a new section
2. If it requires a new decision action, add it to `SKILL.md`

If you add a second vendor (running two flag systems in parallel):

1. Add `references/tool-<vendor-b>.md`
2. Update `SKILL.md` → **Reference Files** section
3. Note in `SKILL.md` under which conditions each vendor is used
