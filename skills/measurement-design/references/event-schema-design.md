# Event Schema Design

Vendor-agnostic guidance for designing events that support experiment analysis.

## TOC

- [Core Event Structure](#core-event-structure)
- [Event Naming Convention](#event-naming-convention)
- [Metric-to-Event Mapping](#metric-to-event-mapping)
- [Upstream vs. Downstream Placement](#upstream-vs-downstream-placement)
- [Common Anti-Patterns](#common-anti-patterns)
- [Instrumentation Checklist](#instrumentation-checklist)

---

## Core Event Structure

Every experiment-relevant event needs at minimum:

```json
{
  "event":      "user_completed_onboarding",
  "user_key":   "usr_abc123",
  "timestamp":  "2026-03-20T14:23:00Z",
  "properties": {
    "session_id":    "sess_xyz",
    "context_field": "value"
  }
}
```

Fields required for experiment analysis:
- **event** — what happened (verb_noun pattern preferred)
- **user_key** — stable identifier that links this event to the flag evaluation record
- **timestamp** — UTC, ISO 8601
- **properties** — context relevant to the metric and the hypothesis

---

## Event Naming Convention

Use `verb_noun` in snake_case:

| Good | Bad |
|---|---|
| `user_completed_onboarding` | `OnboardingComplete` |
| `flag_first_evaluated` | `featureFlagCheck` |
| `checkout_step_abandoned` | `abandon` |
| `ai_skill_session_started` | `chatOpen` |

Name from the user's perspective, not the system's. "User initiated checkout" is more useful than "checkout button clicked."

---

## Metric-to-Event Mapping

| Metric | Event | Fire when |
|---|---|---|
| Onboarding completion rate | `user_completed_onboarding` | User reaches final confirmation step |
| Time-to-first-flag | `flag_first_evaluated` | First successful flag evaluation in the account |
| AI Skill adoption | `ai_skill_session_started` | User sends first message in Chat with AI Skills |
| Checkout conversion | `order_placed` | Payment confirmed |
| Step abandonment | `onboarding_step_abandoned` | User navigates away from an incomplete step |

---

## Upstream vs. Downstream Placement

**Upstream event** (fires early in the funnel): Higher volume, more noise, weaker signal about the outcome you actually care about.

**Downstream event** (fires at the outcome): Lower volume, higher precision, directly tests the hypothesis.

Prefer downstream events for the primary metric. Use upstream events as diagnostics only.

To choose placement, draw the user journey:

```
Entry → Step 1 → Step 2 → [Variant branch here] → Step 3 → Outcome
                                                              ↑
                                                   fire primary metric event here
```

The event must fire AFTER the user has experienced the variant, not before.

---

## Common Anti-Patterns

**Measuring system activity instead of user outcomes**  
Counting API calls or page views when what matters is task completion.

**Conflating exposure with outcome**  
"Saw the modal" is not "completed the task." The event must fire at outcome, not at exposure.

**Missing user_key linkage**  
Events without a stable `user_key` cannot be joined to flag evaluation records. Experiment analysis becomes impossible.

**Server-time vs. client-time timestamps**  
Use server-recorded time for consistency. Client timestamps can drift and skew cohort comparisons.

**Single session proxy for long-term outcome**  
Measuring "added to cart" as a proxy for "purchased" when the conversion window is 3 days. Ensure the event window covers the full conversion cycle.

---

## Instrumentation Checklist

Before starting exposure, confirm:

- [ ] Primary metric event is defined (name, properties, fire location)
- [ ] Event fires after variant is shown, not before
- [ ] `user_key` in the event matches the `user_key` used in flag evaluation
- [ ] Each guardrail metric has a corresponding event
- [ ] Event is firing in the test/staging environment before going to production
- [ ] Event volume is realistic for the expected observation window
