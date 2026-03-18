# Practical Validation Notes

This file is for founder-level validation, not fundraising.

## One-Sentence Definition

FeatBit already controls release through feature flags, and this project adds a decision workflow that lets a coding agent decide whether a rollout should continue based on private measurement data.

## The Practical Loop To Validate

If this project is real, the following loop should work end to end:

1. Write a release brief.
2. Generate `plan.json`.
3. Generate `featbit-actions.json`.
4. Apply FeatBit rollout changes or emit dry-run actions.
5. Run measurement.
6. Produce `results.json`.
7. Produce `summary.md`.
8. Decide whether to continue, pause, or roll back.

If this loop is awkward, confusing, or feels like ceremony, the product still needs simplification.

## Self-Check Questions

After a real self-demo, all of the following should feel true:

- I can explain the product simply.
- I can demo the full loop without hand-waving.
- The boundaries between agent, FeatBit, and measurement are clean.
- This strengthens FeatBit's feature flag infrastructure value.
- I would still want this even if it never became a giant experimentation platform.

## Recommended Next Step For Self-Validation

Do one brutal end-to-end dry run and write down where the confusion appears.

The goal of the next iteration is not to add more ideas.
The goal is to remove ambiguity.