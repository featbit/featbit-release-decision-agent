# Step 3 Sample Briefs

This folder contains short user-brief examples for the MVP workflow.

## Files

1. `agent_variant_comparison.brief.md`
2. `website_conversion_change.brief.md`

## Purpose

Use these briefs to:

1. exercise the planner prompt against realistic input
2. verify recipe selection stays deterministic
3. drive the happy-path demo flow

## Notes

1. These are user-facing briefs, not machine-readable artifacts.
2. The planner should convert them into valid `plan.json` files.
3. The metric pack remains system-selected by recipe.
4. The PostgreSQL data source is still assumed for the MVP.