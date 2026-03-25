# FeatBit Release Decision Plugin

## Executive Summary

FeatBit Release Decision Plugin turns FeatBit's feature flag infrastructure into the execution backbone for agent-assisted release decisions.

Coding agents are becoming the interface for engineering work, but they still lack a trusted way to connect rollout control, system signals, and human context into clear release recommendations. FeatBit can provide that missing layer without building another standalone agent or another broad experimentation platform.

This paper uses three terms consistently:

- `decision inputs`: briefs, pull requests, tickets, and other inputs that initiate a decision
- `system signals`: metrics, measurement data, alerts, logs, and other observable system outputs
- `human context`: market changes, company decisions, strategic priorities, and other human-supplied real-world context

## Core Goal

The goal is to let an existing coding agent turn decision inputs into a structured plan, execute rollout control through FeatBit, evaluate system signals inside the customer's environment together with human context, and return a deterministic recommendation that a human can review, including experiment rollout, safe release, and rapid rollback decisions.

## The Problem

Teams already have coding agents, feature flags, and plenty of system signals, but they do not yet have a trusted operational layer that connects those inputs with the human context behind each decision. Without that layer, experiment rollout, safe release, and rollback decisions stay manual, fragmented, and difficult to audit.

## Why Now

This opportunity exists because agents are becoming the new interface, release control is already programmable, and trust boundaries matter much more once AI workflows can touch code, flags, and data in the same loop.

## Market Gap

There is a gap between coding agents and experimentation platforms: agents can orchestrate, experimentation platforms can analyze, but neither is centered on operational release decisioning with a strong private-data boundary or on combining decision inputs, system signals, and human context into release control decisions. That leaves an opening for FeatBit to own the operational decision layer between code generation and production rollout.

## What FeatBit Is Building

FeatBit is building a narrow release-decision layer around existing coding agents:

- control-plane integration with feature flags and rollout operations
- decision tooling built around system signals and human context
- deterministic recommendation logic
- secure boundaries for private data handling
- machine-readable artifacts that agents and humans can both inspect

Feature flag infrastructure remains the monetizable control plane, and the decision layer makes that infrastructure more valuable and harder to replace.

## Product Wedge

The initial wedge is a single closed loop: a coding agent turns decision inputs into a plan, FeatBit handles rollout control, a local runtime evaluates system signals together with human context, and the system returns a deterministic recommendation.

## Why This Is Defensible

This position is defensible because FeatBit already owns rollout control, can keep measurement inside the customer's environment, and can enforce deterministic behavior through fixed metric templates and structured artifacts.

## Difference from Traditional Experimentation Platforms

FeatBit is not trying to become a general experimentation platform with a large analysis surface, a broad metric modeling layer, and a platform-centric experiment workflow.

That is the shape of traditional experimentation platforms: a platform-centered system for defining metrics, connecting warehouses, running experiment analysis, and consuming results through the product itself.

FeatBit Release Decision Plugin is different in three ways: the primary entry point is the coding agent, the primary output is an operational release decision that can include rollout, safe release, or rollback, and the data boundary is stricter because raw decision data stays in the customer's environment.

This is the strategic distinction: traditional experimentation platforms help teams run experiments through a product UI. FeatBit aims to make coding agents safe and useful for release decisions.

## Why This Matters

This is not about moving beyond feature flags. It is about making feature flag infrastructure more central to production delivery by adding a decision and trust layer around it.

## Core Boundary

The plugin may use existing FeatBit control-plane data where needed for flag operations, but raw decision data, warehouse access, and non-essential customer data should remain in the customer's environment; human context should be treated as explicit controlled input to the release decision.

That boundary is part of the product value, not just an implementation detail.

## Go-To-Market Logic

The product should enter through teams already using FeatBit for feature flags, solve one painful release-decision workflow end to end, and use trust, speed, and auditability as the adoption wedge.

## The Strategic Bet

The strategic bet is that coding agents will become the interface for more engineering work, but enterprises will require trusted control points before those agents can operate across code, data, and production systems.
