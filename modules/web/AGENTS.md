<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# FeatBit Release Decision Agent — Web UI

## Project Overview

This is a Next.js application that provides an interactive web UI for the **FeatBit Release Decision Agent**. It enables product managers, engineers, and data analysts to run data-driven experiments end-to-end — from defining intent to making release decisions — without needing a statistics background.

## Purpose

- **Experiment Management UI** — Create, view, and manage experiments through a visual dashboard.
- **Agent-Driven Experimentation** — Invoke the release decision agent via the UI to guide users through the full experiment loop: intent → hypothesis → implementation → exposure → measurement → interpretation → decision → learning.
- **Data Source Configuration** — Connect to databases, data warehouses, FeatBit instances, and other data sources to feed experiment metrics.
- **Real-Time Analysis** — View Bayesian analysis results, sample size checks, and statistical significance in the browser.
- **Decision Tracking** — Track experiment decisions (CONTINUE / PAUSE / ROLLBACK / INCONCLUSIVE) and learnings across iterations.

## Tech Stack

- **Framework**: Next.js 16 (App Router, React Server Components)
- **Language**: TypeScript
- **Styling**: Tailwind CSS v4 + shadcn/ui (base-nova style)
- **Runtime**: React 19

## Architecture Conventions

- Use the App Router (`src/app/`) with file-based routing.
- Server Components by default; add `"use client"` only when the component requires browser APIs, state, or event handlers.
- Place reusable UI components in `src/components/`. shadcn/ui components live in `src/components/ui/`.
- Shared utilities go in `src/lib/`.
- Custom hooks go in `src/hooks/`.
- API routes go in `src/app/api/`.
- Use `@/*` import alias for all project imports.

## Key Directories

```
src/
  app/                 ← pages, layouts, API routes
  components/
    ui/                ← shadcn/ui primitives (button, card, dialog…)
  hooks/               ← custom React hooks
  lib/                 ← utilities, API clients, types
```

## Coding Standards

- Follow the `vercel-react-best-practices` skill conventions.
- Prefer Server Components and server-side data fetching.
- Use shadcn/ui components for all UI primitives — do not create custom equivalents.
- Keep components small and focused; extract logic into hooks or utilities.
- Use TypeScript strict mode; avoid `any`.

## Relationship to Parent Project

This `agent/` folder is part of the [featbit-release-decision-agent](https://github.com/featbit/featbit-release-decision-agent) mono-repo. The parent project's `skills/` folder contains the agent skills that power the experiment loop. The web UI in this folder provides a visual interface for those same capabilities.
