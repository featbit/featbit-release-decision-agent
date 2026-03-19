# Agent Variant Comparison

We want to compare two coding-agent planner variants for internal task execution.

## Goal

Recommend whether `planner_b` should continue rollout against `planner_a`.

## Context

- the decision key should stay stable and readable for reviewers
- the comparison window should focus on the most recent completed week
- this is an operational release decision, not a statistical experiment report

## Boundaries

- do not accept material cost regression
- do not accept material latency regression
- keep the initial rollout conservative

## Data Hints

- use the inspected PostgreSQL catalog to choose the table
- prefer a table that already contains decision, variant, task, success, cost, latency, and timestamp fields

## Expected Output

1. `plan.json`
2. `results.json`
3. `summary.md`
4. `featbit-actions.json` when the workflow stops at dry-run