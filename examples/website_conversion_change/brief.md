# Website Conversion Change

We want to test a homepage message and CTA change for new evaluation visitors.

## Goal

Recommend whether the candidate homepage experience should continue rollout.

## Context

- the change affects the homepage hero and primary CTA only
- reviewers may not be experts in experimentation metrics
- the workflow should choose the MVP metric pack automatically

## Boundaries

- protect returning docs-seeking users
- keep the initial rollout low risk
- avoid obvious cost or latency regression in the tracked flow

## Data Hints

- use the inspected PostgreSQL catalog to choose a compatible event table
- prefer a table that already contains decision, variant, task, success, cost, latency, and timestamp fields

## Expected Output

1. `plan.json`
2. `results.json`
3. `summary.md`
4. `featbit-actions.json` when the workflow stops at dry-run