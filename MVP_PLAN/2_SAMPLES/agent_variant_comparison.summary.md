# Release Decision Summary

Decision key: `coding_agent_planner`

## Result
`planner_b` improves task success rate by **6.2%** over `planner_a`.

## Guardrails
- avg_cost: pass (+2.1%)
- p95_latency_ms: pass (-0.8%)

## Recommendation
Continue rollout to **25%**.

## Note
This recommendation is based on rule-based metric comparison in the MVP and is not a formal statistical conclusion.
