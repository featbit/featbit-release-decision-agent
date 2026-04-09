# SQL Layout and Design Intent

This folder contains the SQL artifacts for FeatBit experiment data collection and product analytics.

The goal is to support two related but different workloads on the same PostgreSQL foundation:

1. Experiment analysis for release decisions
2. General product analytics such as funnel, retention, cohort, and revenue analysis

The design intentionally keeps a single raw event stream and then builds higher-level query patterns and derived tables on top of it.


## Design Principles

### 1. One raw event table, not two

`metric_events` is the canonical raw event table for both experiment metrics and general analytics events.

Reason:

- Avoid duplicating the same business event into separate "experiment" and "analytics" tables
- Keep event semantics consistent across experimentation, BI, and ad hoc analysis
- Let experiment queries and analytics queries share the same source of truth


### 2. Separate raw storage from analysis-friendly shapes

Raw events are flexible but expensive to query repeatedly at scale.

So the layout is:

- Raw tables for ingestion and ground truth
- Query pattern files for reference SQL
- Derived fact tables and materialized views for faster analytics workloads


### 3. Preserve experiment isolation explicitly

`flag_evaluations` stores `experiment_id` and `layer_id` directly.

Reason:

- Mutual exclusion and layered experiments should be queryable without reconstructing assignment logic later
- Experiment analysis should filter the intended population with a simple predicate such as `WHERE experiment_id = ...`


### 4. Support both binary and continuous metrics

The schema and queries support:

- Binary outcomes: did the user convert or not
- Continuous outcomes: revenue, duration, counts, latest numeric state, and similar metrics

This is why `metric_events` includes `numeric_value`, while binary events are represented by an event existing or not existing.


## File Overview

### `001_event_tables.sql`

Defines the base event tables.

Contents:

- `flag_evaluations`
- `metric_events`
- core indexes
- partitioning examples
- notes about experiment staining and layered isolation

Why it exists:

- Establish the canonical storage model for exposure events and tracked user behavior
- Keep experiment assignment and event facts in PostgreSQL, close to the analysis queries
- Make the raw event table usable for both experimentation and downstream analytics


### `002_query_patterns.sql`

Defines the standard experiment-analysis query patterns.

Contents:

- Binary metric query pattern
- Continuous metric query pattern

Why it exists:

- Provide a clear reference for how the worker computes experiment summaries
- Document the intended analysis model: first exposure, then post-exposure user outcomes
- Make binary and continuous aggregation logic explicit and reviewable


### `003_query_da.sql`

Defines reference SQL for common product analytics workflows on top of `metric_events`.

Contents:

- Funnel conversion
- Daily funnel breakdown
- Signup retention
- Cohort retention rates
- Revenue cohort analysis
- WAU/MAU stickiness

Why it exists:

- Show that the same raw event table can support common DA workflows
- Provide copyable starting points for analysis and dashboard work
- Clarify which queries should remain ad hoc and which may later deserve derived tables or materialized views


### `004_derived_analytics_tables.sql`

Defines derived analytics structures built on top of `metric_events`.

Contents:

- `fact_sessions`
- `fact_user_day`
- `dim_user_first_seen`
- `mv_funnel_daily`
- `mv_retention_d30`
- example load and refresh patterns

Why it exists:

- Move repeated analytics work off the raw event table
- Provide stable grains for BI, product dashboards, and operational reporting
- Show the intended direction for scale: raw events first, then derived tables/views for performance and simplicity


## Recommended Layering Model

The intended architecture is:

1. SDKs write raw exposure and behavior events
2. PostgreSQL stores them in `flag_evaluations` and `metric_events`
3. The worker reads raw events for experiment summaries
4. Derived tables and materialized views serve broader analytics use cases

In short:

- Raw layer = truth
- Query patterns = logic examples
- Derived layer = performance and usability


## When to Add New SQL Files

Add a new SQL file when one of these is true:

- A new analysis pattern is broadly reusable
- A derived table or materialized view becomes operationally important
- A schema change affects event collection or experiment isolation

Do not add a second raw event table unless there is a very strong operational reason.
In most cases, extending the existing raw model and deriving new shapes is the better design.


## Practical Guidance

- Keep `flag_evaluations` focused on assignment and exposure facts
- Keep `metric_events` as the single raw behavior event stream
- Prefer adding derived facts or materialized views instead of duplicating raw ingestion
- Treat `002_query_patterns.sql` and `003_query_da.sql` as reference logic, not final production reporting code
- If query volume grows, move repeated logic into scheduled refresh jobs over the derived layer