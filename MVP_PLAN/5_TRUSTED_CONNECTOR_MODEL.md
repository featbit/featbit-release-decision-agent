# Trusted Connector Model

## Purpose

This document defines the next-step credential model that should replace direct raw database connection input for normal operation.

The MVP currently allows:

1. `--connection-env` as the preferred runtime path
2. `--connection` as a development-only fallback

That is acceptable for early development, but it is not the target operating model.

## Goal State

Normal workflow should reference a trusted connector by `data_source_id` instead of passing raw credentials through the CLI surface.

## Target Artifact Change

Future plans should move from this pattern:

```json
{
  "data_source_kind": "postgres",
  "table": "public.decision_events"
}
```

to this pattern:

```json
{
  "data_source_kind": "postgres",
  "data_source_id": "customer-prod-metrics",
  "table": "public.decision_events"
}
```

## Core Rules

1. `data_source_id` is an opaque identifier, not a secret.
2. The agent can see `data_source_id`.
3. The agent must not see the underlying password, token, or connection string.
4. Runtime resolution from `data_source_id` to credentials happens in a trusted execution environment.
5. Plans, summaries, prompts, and dry-run artifacts must remain secret-free.

## Trusted Resolution Boundary

The trusted execution side should be responsible for:

1. loading encrypted connector metadata
2. decrypting or retrieving credentials
3. constructing the final database connection
4. auditing connector usage
5. enforcing environment-level access control

The agent side should be responsible for:

1. selecting the recipe
2. generating `plan.json`
3. validating schema compatibility
4. invoking the runtime using `data_source_id`
5. interpreting `results.json`

## Minimal Future CLI Shape

Current shape:

```powershell
featbit-decision inspect --data-source-kind postgres --connection-env FB_DECISION_PG --out artifacts/catalog.json
```

Future shape:

```powershell
featbit-decision inspect --data-source-kind postgres --data-source-id customer-prod-metrics --out artifacts/catalog.json
```

And similarly for `run`:

```powershell
featbit-decision run --plan artifacts/plan.json --catalog artifacts/catalog.json --data-source-id customer-prod-metrics --out artifacts/results.json
```

## Connector Record Fields

A trusted connector record should include fields like:

1. `data_source_id`
2. `kind`
3. `environment`
4. `display_name`
5. `credential_reference`
6. `allowed_schemas`
7. `allowed_tables`
8. `created_by`
9. `last_rotated_at`

## Security Properties

The model should guarantee:

1. prompts never carry secrets
2. logs never print raw credentials
3. rotation does not require plan regeneration
4. environment policy can block unauthorized connector use
5. audit logs can answer who used which connector and when

## Migration Path

### Phase 1

Current MVP:

- use `--connection-env` in normal usage
- keep `--connection` as development-only fallback

### Phase 2

Add connector resolution support:

- add `--data-source-id`
- load trusted connector metadata in the runtime
- keep `--connection-env` only for local development

### Phase 3

Production default:

- remove raw credential handling from normal workflows
- keep dev overrides behind explicit local-only switches if still needed

## Non-Goals

This document does not define:

1. the storage backend for encrypted connector records
2. the exact KMS or secret manager choice
3. the FeatBit-side UI for connector management
4. multi-tenant RBAC policy details

## Implementation Consequences

When this model is implemented, the following areas must change together:

1. `plan.json` contract
2. CLI options and help text
3. runtime connection resolution
4. demo scripts and examples
5. prompt instructions that mention connection handling