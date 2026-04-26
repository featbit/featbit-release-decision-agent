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

## UI Style Contract

Use `C:\Code\featbit\featbit-support` as the visual reference for layout rhythm, typography, surface treatment, and component density. Do not copy its blue theme color or sparkles-style mark into this app: keep this project's FeatBit green primary color and existing logo.

### Visual Language

- Default to light mode. Dark mode is supported, but light mode is the primary design target.
- Use Manrope for sans text and JetBrains Mono for code/technical values.
- Keep the app calm, spacious, and operational: soft fixed background gradients, translucent panels, clear borders, and restrained shadows.
- Prefer `glass-panel` for page-level hero/header blocks and `surface-panel` for lists, cards, tables, and loading/empty states.
- Avoid heavy decorative effects, saturated full-page gradients, oversized shadows, nested cards, or marketing-style hero layouts.
- Use 8-12px radii for panels and controls. Buttons, tabs, badges, and sidebar items should feel compact and dense.

### Typography

- Page H1: `text-3xl font-black tracking-tight`.
- Page subtitle/description: `mt-1 text-sm text-muted-foreground`.
- Section/card title: `text-base font-bold tracking-tight` or the local `CardTitle` default when enough.
- List item title: `text-[15px] font-bold tracking-tight`.
- Metadata/help text: `text-xs text-muted-foreground`, with `font-medium` for chips or labels.
- Do not use negative letter spacing beyond Tailwind's normal `tracking-tight` utilities.

### Layout Patterns

- Main dashboard pages should sit in `mx-auto max-w-6xl` with `space-y-6` and modest page padding from the route layout.
- Page headers should be full-width content bands, usually `glass-panel flex flex-col gap-4 rounded-xl p-4 md:flex-row md:items-center md:justify-between`.
- Lists should prefer one `surface-panel overflow-hidden rounded-xl divide-y divide-border/70` wrapper instead of many detached decorative cards.
- Sidebar navigation should match the support hub density: 13px-ish labels, semibold text, active item with primary background, and a small workspace/theme block near the bottom.

### Component Rules

- Use existing shadcn/ui primitives from `src/components/ui` first.
- Buttons should remain compact, icon-led when possible, and only use strong shadowing for primary calls to action.
- Badges should be small, rounded, and information-dense. Do not create large pill-heavy status rows.
- Chat bubbles and agent panels should use the same `surface-panel` language: light borders, white/translucent surfaces, and modest rounded rectangles.
- Theme toggles should be explicit controls; in sidebars use the compact icon button paired with a `Theme` label.

## Relationship to Parent Project

This `agent/` folder is part of the [featbit-release-decision-agent](https://github.com/featbit/featbit-release-decision-agent) mono-repo. The parent project's `skills/` folder contains the agent skills that power the experiment loop. The web UI in this folder provides a visual interface for those same capabilities.
