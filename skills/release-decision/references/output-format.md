# Output Format

The final output presented to the user is a **recommendation card**. It is derived from `results.json` and `summary.md` and presented in plain language, not as raw JSON.

## Recommendation Card Structure

```
## Release Decision: <flag or feature name>

**Recommendation:** <CONTINUE | PAUSE | ROLLBACK CANDIDATE | INCONCLUSIVE>

**Summary**
<1-3 sentences explaining the recommendation in reviewer language. Source: summary.md>

**Metric Results**

| Metric | Baseline | Candidate | Status |
|---|---|---|---|
| Task success rate (primary) | <value> | <value> | <PASS / FAIL> |
| Avg cost (guardrail) | <value> | <value> | <PASS / FAIL> |
| P95 latency ms (guardrail) | <value> | <value> | <PASS / FAIL> |

**Next Step**
<One concrete action — see the table below>
```

## Next Step by Recommendation

| Recommendation | Next Step |
|---|---|
| `continue` | Extend rollout to the next percentage tier (or apply `featbit-actions.json` to update the flag). |
| `pause` | Hold rollout at current percentage. Investigate the guardrail metric that failed before proceeding. |
| `rollback_candidate` | Disable the flag or reduce rollout to 0%. Apply `featbit-actions.json` for the rollback operation. |
| `inconclusive` | Collect more events. Suggest a minimum sample size or wait period before re-running the decision. |

## Language Rules

Use measured, reviewer-friendly language. Avoid:

- ❌ "This is statistically significant" → ✅ "This meets the exit criteria directionally"
- ❌ "The experiment proves the variant is better" → ✅ "The candidate shows a positive trend within guardrail bounds"
- ❌ "You should definitely roll back" → ✅ "The primary metric has regressed — this is a rollback candidate"
- ❌ "95% confidence interval" → ✅ "based on the collected sample"

## Example — continue

```
## Release Decision: homepage-hero-cta-v2

**Recommendation:** CONTINUE

**Summary**
The candidate variant shows a directionally positive task success rate (+4.2%) compared to baseline.
Both guardrail metrics are within acceptable bounds. The rollout is safe to extend.

**Metric Results**

| Metric | Baseline | Candidate | Status |
|---|---|---|---|
| Task success rate (primary) | 31.2% | 35.4% | PASS |
| Avg cost (guardrail) | $0.012 | $0.011 | PASS |
| P95 latency ms (guardrail) | 420ms | 395ms | PASS |

**Next Step**
Apply `artifacts/featbit-actions.json` to extend rollout from 10% to 25%.
```

## Example — pause

```
## Release Decision: checkout-agent-v2

**Recommendation:** PAUSE

**Summary**
The candidate agent variant improves task success rate (+6.1%) but average cost per task has
increased 38% above baseline, exceeding the guardrail threshold. Hold the rollout and investigate
the cost regression before proceeding.

**Metric Results**

| Metric | Baseline | Candidate | Status |
|---|---|---|---|
| Task success rate (primary) | 71.4% | 77.5% | PASS |
| Avg cost (guardrail) | $0.042 | $0.058 | FAIL |
| P95 latency ms (guardrail) | 1,840ms | 1,910ms | PASS |

**Next Step**
Investigate the cost increase in the candidate agent. Re-run the decision after the cost regression is addressed.
```

## Dry-Run Action File

When `featbit-actions.json` is relevant, briefly describe the recommended action:

```
**Proposed FeatBit Action** (requires operator approval)
Action type: set_rollout_percentage
Flag key: homepage-hero-cta-v2
Target: 25%
Review `artifacts/featbit-actions.json` before applying.
```

Do not apply the action automatically unless direct execution has been explicitly authorized.
