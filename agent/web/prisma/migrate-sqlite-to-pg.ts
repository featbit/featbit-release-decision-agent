#!/usr/bin/env npx tsx
/**
 * One-time migration: SQLite dev.db → PostgreSQL
 *
 * Reads all data from dev.db via better-sqlite3 and writes it into PG via Prisma.
 * Safe to re-run: clears PG tables before inserting.
 *
 * Usage:  npx tsx prisma/migrate-sqlite-to-pg.ts
 */

import "dotenv/config";
import Database from "better-sqlite3";
import path from "node:path";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// ── Source: SQLite ───────────────────────────────────────────────────────────
const dbPath = path.join(process.cwd(), "prisma", "dev.db");
const sqlite = new Database(dbPath, { readonly: true });

// ── Target: PostgreSQL ───────────────────────────────────────────────────────
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

// ── Helpers ──────────────────────────────────────────────────────────────────
function readAll<T>(table: string): T[] {
  return sqlite.prepare(`SELECT * FROM "${table}"`).all() as T[];
}

function toDate(v: unknown): Date | null {
  if (v == null) return null;
  if (typeof v === "string" || typeof v === "number") return new Date(v);
  return null;
}

function toBool(v: unknown): boolean {
  if (v === 1 || v === true) return true;
  return false;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  // Read everything from SQLite
  const projects = readAll<Record<string, unknown>>("Project");
  const experiments = readAll<Record<string, unknown>>("Experiment");
  const activities = readAll<Record<string, unknown>>("Activity");
  const messages = readAll<Record<string, unknown>>("Message");

  console.log(`SQLite → ${projects.length} projects, ${experiments.length} experiments, ${activities.length} activities, ${messages.length} messages`);

  // Clear PG (order matters for FK constraints)
  await prisma.message.deleteMany();
  await prisma.activity.deleteMany();
  await prisma.experiment.deleteMany();
  await prisma.project.deleteMany();
  console.log("PG cleared.");

  // Insert projects
  for (const p of projects) {
    await prisma.project.create({
      data: {
        id: p.id as string,
        name: p.name as string,
        description: p.description as string | null,
        stage: p.stage as string,
        createdAt: toDate(p.createdAt)!,
        updatedAt: toDate(p.updatedAt)!,
        flagKey: p.flagKey as string | null,
        envSecret: p.envSecret as string | null,
        accessToken: p.accessToken as string | null,
        flagServerUrl: p.flagServerUrl as string | null,
        sandboxId: p.sandboxId as string | null,
        sandboxStatus: p.sandboxStatus as string | null,
        goal: p.goal as string | null,
        intent: p.intent as string | null,
        hypothesis: p.hypothesis as string | null,
        change: p.change as string | null,
        variants: p.variants as string | null,
        primaryMetric: p.primaryMetric as string | null,
        guardrails: p.guardrails as string | null,
        constraints: p.constraints as string | null,
        openQuestions: p.openQuestions as string | null,
        lastAction: p.lastAction as string | null,
        lastLearning: p.lastLearning as string | null,
      },
    });
  }
  console.log(`✓ ${projects.length} projects`);

  // Insert experiments
  for (const e of experiments) {
    await prisma.experiment.create({
      data: {
        id: e.id as string,
        projectId: e.projectId as string,
        slug: e.slug as string,
        status: e.status as string,
        createdAt: toDate(e.createdAt)!,
        updatedAt: toDate(e.updatedAt)!,
        hypothesis: e.hypothesis as string | null,
        method: e.method as string | null,
        methodReason: e.methodReason as string | null,
        primaryMetricEvent: e.primaryMetricEvent as string | null,
        metricDescription: e.metricDescription as string | null,
        guardrailEvents: e.guardrailEvents as string | null,
        guardrailDescriptions: e.guardrailDescriptions as string | null,
        controlVariant: e.controlVariant as string | null,
        treatmentVariant: e.treatmentVariant as string | null,
        trafficAllocation: e.trafficAllocation as string | null,
        minimumSample: e.minimumSample as number | null,
        observationStart: toDate(e.observationStart),
        observationEnd: toDate(e.observationEnd),
        priorProper: toBool(e.priorProper),
        priorMean: e.priorMean as number | null,
        priorStddev: e.priorStddev as number | null,
        inputData: e.inputData as string | null,
        analysisResult: e.analysisResult as string | null,
        decision: e.decision as string | null,
        decisionSummary: e.decisionSummary as string | null,
        decisionReason: e.decisionReason as string | null,
        whatChanged: e.whatChanged as string | null,
        whatHappened: e.whatHappened as string | null,
        confirmedOrRefuted: e.confirmedOrRefuted as string | null,
        whyItHappened: e.whyItHappened as string | null,
        nextHypothesis: e.nextHypothesis as string | null,
      },
    });
  }
  console.log(`✓ ${experiments.length} experiments`);

  // Insert activities
  for (const a of activities) {
    await prisma.activity.create({
      data: {
        id: a.id as string,
        projectId: a.projectId as string,
        type: a.type as string,
        title: a.title as string,
        detail: a.detail as string | null,
        createdAt: toDate(a.createdAt)!,
      },
    });
  }
  console.log(`✓ ${activities.length} activities`);

  // Insert messages
  for (const m of messages) {
    await prisma.message.create({
      data: {
        id: m.id as string,
        projectId: m.projectId as string,
        role: m.role as string,
        content: m.content as string,
        metadata: m.metadata as string | null,
        createdAt: toDate(m.createdAt)!,
      },
    });
  }
  console.log(`✓ ${messages.length} messages`);

  console.log("\nMigration complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => {
    sqlite.close();
    prisma.$disconnect();
  });
