# Sample Brief: Agent Variant Comparison

We want to compare two coding-agent planner variants for internal task execution.

## Goal

Recommend whether `planner_b` should continue rollout against `planner_a`.

## Context

- decision key should be stable and readable for reviewers
- the comparison window should focus on the most recent completed week
- this is an internal agent quality check, not a formal experiment report

## Boundaries

- do not accept material cost regression
- do not accept material latency regression
- keep the first rollout conservative

## Data Hints

- use the inspected PostgreSQL catalog to find the right table
- prefer the table that already contains decision, variant, task, success, cost, latency, and timestamp fields

## Expected Outcome

The workflow should produce:

1. `plan.json`
2. `results.json`
3. `summary.md`
4. `featbit-actions.json` if the run stops at dry-run