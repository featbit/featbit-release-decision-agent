# Tool Adapter: FeatBit CLI

**Vendor:** FeatBit  
**Tool type:** CLI  
**Default for skill:** `reversible-exposure-control`

This file documents how to use the FeatBit CLI to execute flag operations that implement the reversible-exposure-control skill.

## TOC

- [Prerequisites](#prerequisites)
- [Core Operations](#core-operations)
- [Environment Management](#environment-management)
- [Reference](#reference)

---

## Prerequisites

FeatBit CLI installed and authenticated. See [FeatBit CLI documentation](https://docs.featbit.co) for installation and authentication setup.

Verify your installation:

```bash
featbit --version
featbit --help
```

---

## Core Operations

### 1. Create a Feature Flag

Intent: "Make this change reversible before it is visible."

```bash
featbit flag create \
  --key "my-feature-flag" \
  --name "My Feature Flag" \
  --type boolean \
  --env <environment-key>
```

**Naming conventions:**
- Use kebab-case: `new-checkout-flow`, not `NewCheckoutFlow`
- Include context: `onboarding-progress-bar`, not `progress-bar`
- Key is environment-agnostic (same key, different environments)
- Created in the OFF state by default — do not enable immediately

---

### 2. Add Variants for A/B

For experiments, define explicit variant names:

```bash
featbit flag add-variant \
  --key "my-feature-flag" \
  --variant-key "control" \
  --variant-name "Control (baseline)"

featbit flag add-variant \
  --key "my-feature-flag" \
  --variant-key "treatment" \
  --variant-name "Treatment (candidate)"
```

---

### 3. Set Percentage Rollout

Intent: "Start exposing to X% of users."

```bash
featbit flag rollout \
  --key "my-feature-flag" \
  --variant "treatment" \
  --percentage 10 \
  --env <environment-key>
```

Default starting percentage: **5–10%**. See `rollout-patterns.md` for guidance on when to start higher or lower.

---

### 4. Add Targeting Rules

Intent: "Show this to a specific audience first / protect specific users."

```bash
featbit flag target \
  --key "my-feature-flag" \
  --rule "user.team == internal" \
  --serve "treatment" \
  --env <environment-key>
```

Targeting rules are evaluated before percentage rollout. Use them to implement protected audiences.

---

### 5. Enable the Flag

Flags are created OFF. Enable explicitly when ready to expose:

```bash
featbit flag enable \
  --key "my-feature-flag" \
  --env <environment-key>
```

---

### 6. Rollback (Disable Flag Immediately)

Intent: "Rollback NOW."

```bash
featbit flag disable \
  --key "my-feature-flag" \
  --env <environment-key>
```

All users fall back to the default (off) value. This is the primary rollback mechanism.

---

### 7. Expand Rollout

Intent: "Move from 10% to 25%."

```bash
featbit flag rollout \
  --key "my-feature-flag" \
  --variant "treatment" \
  --percentage 25 \
  --env <environment-key>
```

Only expand when expansion criteria from `rollout-patterns.md` are met.

---

## Environment Management

- Always specify `--env` explicitly
- Use environment-specific keys (e.g., `production`, `staging`, `beta`)
- Never run flag changes against `production` without first verifying in `staging`

---

## Reference

For full CLI command reference and authentication setup, see the [FeatBit CLI documentation](https://docs.featbit.co).

> **Note:** Command syntax above reflects common FeatBit CLI patterns. Verify against your installed version (`featbit --help`) as syntax may vary across releases.
