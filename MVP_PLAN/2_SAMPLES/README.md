# Step 2 Sample Artifacts

This folder contains sample machine-readable artifacts for Step 2 of the MVP plan.

## Files

1. `agent_variant_comparison.plan.json`
2. `agent_variant_comparison.featbit-actions.json`
3. `agent_variant_comparison.results.json`
4. `agent_variant_comparison.summary.md`
5. `website_conversion_change.plan.json`
6. `website_conversion_change.featbit-actions.json`
7. `website_conversion_change.results.json`
8. `website_conversion_change.summary.md`

## Purpose

Use these files as the initial reference for:

1. validator behavior
2. runtime serialization
3. prompt output targets
4. demo flow construction

## Notes

1. These samples follow the contracts defined in `../2_SYSTEM_CONTRACTS.md`.
2. The sample plans currently demonstrate the PostgreSQL adapter only.
3. The inspected schema is expected to come from a user-provided connection string, not from a predeclared fixed warehouse shape.
4. The website recipe still uses the MVP's shared metric surface and does not yet introduce a separate website analytics model.
5. These files are examples for implementation and validation, not production data.
