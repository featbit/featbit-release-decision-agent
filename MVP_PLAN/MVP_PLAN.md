# FeatBit Release Decision MVP Plan

## Goal

Build the smallest release decision MVP that lets an agent:

1. take a user goal and constraints
2. map it to a supported decision recipe
3. generate `plan.json` and `featbit-actions.json`
4. reuse existing FeatBit tooling for rollout actions or fall back to dry-run
5. run approved measurement templates in the user's environment
6. output a deterministic recommendation and reviewer-friendly summary

## Non-Negotiable Rules

1. The user provides goals and boundaries. The system provides metrics, guardrails, rollout defaults, and decision method.
2. `plan.json` is system-generated.
3. Only approved templates can run. No LLM-generated SQL.
4. Existing FeatBit control-plane behavior must be reused, not rebuilt.
5. Reviewer output must be understandable by a non-expert.
6. Raw database credentials must not be stored in prompts, artifacts, or logs.
7. Preferred database access is by environment-variable reference or a trusted local connector, not a raw connection string in the agent context.

## Scope

### Include

1. `agent_variant_comparison` recipe
2. `website_conversion_change` recipe
3. data source adapter abstraction
4. PostgreSQL as the current minimal supported adapter
5. `plan.json`
6. `featbit-actions.json`
7. `catalog.json`
8. `results.json`
9. `summary.md`
10. `featbit-decision` CLI with `inspect`, `validate-plan`, `run`, `sync-dry-run`

### Exclude

1. statistical experimentation engine
2. arbitrary user-defined metrics
3. arbitrary SQL generation
4. web UI
5. prebuilt adapters for every customer data source
6. auto-rollback automation

## Implementation Layers

### Agent Skills And Workflow

Do:

1. interpret user intent
2. select recipe
3. synthesize artifacts
4. choose tool order
5. generate reviewer summary

Do not do:

1. metric math
2. rollout execution logic
3. free-form SQL generation

### featbit-decision Runtime

Do:

1. load recipes
2. validate plans
3. inspect schema
4. execute approved templates
5. compute deterministic recommendations
6. write artifacts
7. route requests through a data source adapter

Do not do:

1. feature flag CRUD
2. rollout control implementation

### FeatBit MCP Or CLI

Do:

1. ensure flag exists
2. ensure variants exist
3. set rollout percentage
4. attach supported metadata if available

### Scripts

Do:

1. run demo flow
2. glue commands together
3. support local and CI execution

Do not do:

1. core decision logic

## Build Order

### Step 1: Define Decision Recipes

Deliver:

1. recipe catalog document
2. `agent_variant_comparison` recipe definition
3. `website_conversion_change` recipe definition
4. metric pack for each recipe
5. guardrail pack for each recipe
6. rollout default for each recipe
7. reviewer summary framing for each recipe

Done when:

1. every supported user goal maps to one recipe
2. recipe definitions fully determine metrics and guardrails
3. no user metric configuration is required

### Step 2: Define System Contracts

Deliver:

1. `plan.json` contract
2. `featbit-actions.json` contract
3. `catalog.json` contract
4. `results.json` contract
5. `summary.md` contract
6. sample artifacts for both recipes

Done when:

1. all required fields are defined
2. artifacts are machine-readable and stable
3. plan generation is recipe-driven

### Step 3: Scaffold featbit-decision

Deliver:

1. project structure
2. CLI entry point
3. models
4. file store
5. command skeletons for `inspect`, `validate-plan`, `run`, `sync-dry-run`

Done when:

1. commands execute non-interactively
2. input and output paths are stable
3. commands can be called from scripts or agent sessions

### Step 4: Implement validate-plan First

Deliver:

1. recipe-aware plan validator
2. validation errors for unsupported recipes
3. validation errors for unsupported metrics and guardrails
4. validation errors for bad time range, bad table, bad variant shape, bad randomization unit

Done when:

1. invalid plans fail deterministically
2. valid plans pass without manual fixes
3. validator enforces recipe constraints instead of free-form config

### Step 5: Implement sync-dry-run Second

Deliver:

1. conversion from plan to `featbit-actions.json`
2. dry-run fallback artifact
3. action shape for ensure-flag, ensure-variants, set-rollout

Done when:

1. workflow can continue without direct FeatBit access
2. control intent is auditable

### Step 6: Implement run Third

Deliver:

1. metric template registry
2. approved SQL templates
3. query execution pipeline
4. result aggregation
5. recommendation engine
6. `results.json`
7. `summary.md`

Done when:

1. only approved templates can execute
2. results are deterministic
3. recommendation is one of `continue`, `pause`, `rollback_candidate`, `inconclusive`
4. summary is readable by a non-expert reviewer

### Step 7: Implement inspect Fourth

Deliver:

1. PostgreSQL schema inspector through the data source adapter abstraction
2. `catalog.json` output
3. optional simple mapping support

Done when:

1. required tables and columns can be verified
2. unsupported schema is rejected clearly

### Step 8: Add Agent Workflow Files

Deliver:

1. planner system prompt
2. summary system prompt
3. control policy prompt
4. workflow document with exact execution order

Done when:

1. an agent can take a user brief and produce artifacts consistently
2. direct execution and dry-run paths are both documented

### Step 9: Add Demo And Tests

Deliver:

1. happy-path demo flow
2. sample brief for each recipe
3. invalid-plan tests
4. recommendation rule tests
5. dry-run fallback test

Done when:

1. the demo is repeatable
2. failure modes are understandable
3. core decision behavior is test-covered

## Immediate Next Tasks

Do these now, in order:

Core MVP tasks in this plan are complete.

Next work, if started, belongs to production hardening rather than MVP definition.

## MVP Completion Criteria

The MVP is done when all of the following are true:

1. a user can express a goal without choosing technical metrics
2. the system maps that goal to a supported recipe
3. the agent generates `plan.json` and `featbit-actions.json`
4. `featbit-decision validate-plan` rejects invalid plans deterministically
5. `featbit-decision run` executes approved templates and writes `results.json`
6. the workflow uses existing FeatBit tooling for rollout actions or safely falls back to dry-run
7. `summary.md` is understandable to a non-expert reviewer

## Update Rule

If priorities or product understanding change, update this file first, then update implementation.
