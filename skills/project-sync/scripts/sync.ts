#!/usr/bin/env npx tsx
/**
 * sync.ts — CLI bridge from agent skills to the web database.
 *
 * All release-decision skills use this script to read/write project state.
 * No skill should construct raw HTTP requests — always call sync.ts.
 *
 * COMMANDS
 * ─────────────────────────────────────────────────────────────────────────────
 *  get-project     <projectId>
 *  update-state    <projectId> --<field> "<value>" ...
 *  set-stage       <projectId> <stage>
 *  add-activity    <projectId> --type <type> --title "<title>" [--detail "..."]
 *
 *  create-run      <projectId> <slug> [--field value ...]
 *  start-run       <projectId> <slug>
 *  pause-run       <projectId> <slug>
 *  complete-run    <projectId> <slug>
 *  save-input      <projectId> <slug> --inputData '<json>'
 *  save-result     <projectId> <slug> --analysisResult '<json>'
 *  record-decision <projectId> <slug> --decision <DECISION> --decisionSummary "..." [--decisionReason "..."]
 *  save-learning   <projectId> <slug> --whatChanged "..." --whatHappened "..." [--confirmedOrRefuted "..." --whyItHappened "..." --nextHypothesis "..."]
 *
 * CANONICAL ENUMS (enforced by this script)
 * ─────────────────────────────────────────────────────────────────────────────
 *  stage:             intent | hypothesis | implementing | measuring | learning
 *  activity type:     stage_update | field_update | run_created | run_started |
 *                     run_paused | run_completed | decision_recorded | learning_captured
 *  run status:        draft | running | paused | completed | archived
 *  method:            bayesian_ab | frequentist | bandit
 *  decision:          CONTINUE | PAUSE | ROLLBACK | INCONCLUSIVE
 *  primaryMetricType: binary | continuous
 *  primaryMetricAgg:  once | sum | last
 *
 * FIELD FORMAT STANDARDS (for update-state)
 * ─────────────────────────────────────────────────────────────────────────────
 *  variants:      pipe-separated  →  "key1 (annotation1)|key2 (annotation2)"
 *                 e.g. "standard (control)|streamlined (treatment)"
 *  primaryMetric: plain text paragraph — event name + rationale for choosing it
 *  guardrails:    newline-separated list of guardrail descriptions (plain text)
 *
 * GUARDRAIL EVENTS (create-run / update fields)
 * ─────────────────────────────────────────────────────────────────────────────
 *  Pass --guardrailEvents as comma-separated event names.
 *  sync.ts automatically converts to JSON array for storage.
 *  e.g. --guardrailEvents "checkout_abandoned,support_chat_open"
 *
 * Environment:
 *   SYNC_API_URL — base URL of the web app (default: http://localhost:3000)
 */

const API_BASE = process.env.SYNC_API_URL ?? "http://localhost:3000";

// ── Canonical enums ───────────────────────────────────────────────────────────

const VALID_STAGES = new Set(["intent", "hypothesis", "implementing", "measuring", "learning"]);

const VALID_ACTIVITY_TYPES = new Set([
  "stage_update",
  "field_update",
  "run_created",
  "run_started",
  "run_paused",
  "run_completed",
  "decision_recorded",
  "learning_captured",
]);

const VALID_RUN_STATUSES = new Set(["draft", "running", "paused", "completed", "archived"]);

const VALID_METHODS = new Set(["bayesian_ab", "frequentist", "bandit"]);

const VALID_DECISIONS = new Set(["CONTINUE", "PAUSE", "ROLLBACK", "INCONCLUSIVE"]);

const VALID_METRIC_TYPES = new Set(["binary", "continuous"]);

const VALID_METRIC_AGG = new Set(["once", "sum", "last"]);

// Fields allowed in update-state
const ALLOWED_STATE_FIELDS = new Set([
  "goal", "intent", "hypothesis", "change", "variants",
  "primaryMetric", "guardrails", "constraints",
  "openQuestions", "lastAction", "lastLearning", "flagKey",
]);

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        result[key] = next;
        i++;
      } else {
        result[key] = "true";
      }
    }
  }
  return result;
}

function requireEnum(value: string, valid: Set<string>, name: string): void {
  if (!valid.has(value)) {
    console.error(`Invalid ${name}: "${value}". Valid values: ${[...valid].join(" | ")}`);
    process.exit(1);
  }
}

/** Convert comma-separated event names to JSON array string for DB storage */
function guardrailEventsToJson(csv: string): string {
  const events = csv.split(",").map((e) => e.trim()).filter(Boolean);
  return JSON.stringify(events);
}

async function api(
  method: string,
  path: string,
  body?: Record<string, unknown>,
  options?: { exitOnError?: boolean }
): Promise<unknown> {
  const url = `${API_BASE}${path}`;
  const exitOnError = options?.exitOnError ?? true;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (exitOnError) {
      console.error(`Unable to reach sync API at ${API_BASE}. ${message}`);
      process.exit(1);
    }
    return null;
  }

  const data = await res.json();
  if (!res.ok) {
    if (exitOnError) {
      console.error(`ERROR ${res.status}:`, data);
      process.exit(1);
    }
    return null;
  }
  return data;
}

// ── Commands ──────────────────────────────────────────────────────────────────

async function getProject(projectId: string) {
  const project = await api("GET", `/api/experiments/${projectId}`, undefined, {
    exitOnError: false,
  });
  if (project === null) {
    console.log(
      JSON.stringify(
        { status: "unavailable", projectId, message: "Database unreachable — treat as blank project" },
        null,
        2
      )
    );
    return;
  }
  console.log(JSON.stringify(project, null, 2));
}

async function updateState(projectId: string, flags: Record<string, string>) {
  if (Object.keys(flags).length === 0) {
    console.error("No state fields provided. Use --goal, --intent, --hypothesis, etc.");
    console.error(`Allowed fields: ${[...ALLOWED_STATE_FIELDS].join(", ")}`);
    process.exit(1);
  }
  // Validate variants format if provided
  if (flags.variants && flags.variants.includes("{")) {
    console.error('variants must be pipe-separated: "key1 (annotation1)|key2 (annotation2)"');
    console.error('Example: --variants "standard (control)|streamlined (treatment)"');
    process.exit(1);
  }
  // Filter to only allowed fields
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flags)) {
    if (ALLOWED_STATE_FIELDS.has(key)) body[key] = value;
  }
  if (Object.keys(body).length === 0) {
    console.error(`None of the provided fields are valid. Allowed: ${[...ALLOWED_STATE_FIELDS].join(", ")}`);
    process.exit(1);
  }
  const result = await api("PUT", `/api/experiments/${projectId}/state`, body);
  console.log(JSON.stringify(result, null, 2));
}

async function setStage(projectId: string, stage: string) {
  requireEnum(stage, VALID_STAGES, "stage");
  const result = await api("PUT", `/api/experiments/${projectId}/stage`, { stage });
  console.log(JSON.stringify(result, null, 2));
}

async function addActivity(projectId: string, flags: Record<string, string>) {
  const { type, title, detail } = flags;
  if (!type || !title) {
    console.error("--type and --title are required.");
    process.exit(1);
  }
  requireEnum(type, VALID_ACTIVITY_TYPES, "activity type");
  const result = await api("POST", `/api/experiments/${projectId}/activity`, { type, title, detail });
  console.log(JSON.stringify(result, null, 2));
}

/** Build the body for create-run / any run update, applying type coercions and validations */
function buildRunBody(flags: Record<string, string>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flags)) {
    if (key === "minimumSample") {
      body[key] = parseInt(value, 10);
    } else if (key === "priorProper") {
      body[key] = value === "true" || value === "1";
    } else if (key === "priorMean" || key === "priorStddev" || key === "trafficPercent") {
      body[key] = parseFloat(value);
    } else if (key === "trafficOffset") {
      body[key] = parseInt(value, 10);
    } else if (key === "observationStart" || key === "observationEnd") {
      body[key] = new Date(value).toISOString();
    } else if (key === "guardrailEvents") {
      // Accept comma-separated; convert to JSON array for storage
      body[key] = guardrailEventsToJson(value);
    } else if (key === "method") {
      requireEnum(value, VALID_METHODS, "method");
      body[key] = value;
    } else if (key === "primaryMetricType") {
      requireEnum(value, VALID_METRIC_TYPES, "primaryMetricType");
      body[key] = value;
    } else if (key === "primaryMetricAgg") {
      requireEnum(value, VALID_METRIC_AGG, "primaryMetricAgg");
      body[key] = value;
    } else {
      body[key] = value;
    }
  }
  return body;
}

async function createRun(projectId: string, slug: string, flags: Record<string, string>) {
  const body = { slug, status: "draft", ...buildRunBody(flags) };
  const result = await api("POST", `/api/experiments/${projectId}/experiment-run`, body);
  console.log(JSON.stringify(result, null, 2));
}

async function setRunStatus(projectId: string, slug: string, status: string) {
  requireEnum(status, VALID_RUN_STATUSES, "run status");
  const result = await api("POST", `/api/experiments/${projectId}/experiment-run`, { slug, status });
  console.log(JSON.stringify(result, null, 2));
}

async function saveInput(projectId: string, slug: string, flags: Record<string, string>) {
  if (!flags.inputData) {
    console.error("--inputData is required (JSON string of collected metrics).");
    process.exit(1);
  }
  // Validate it is valid JSON
  try { JSON.parse(flags.inputData); } catch {
    console.error("--inputData must be a valid JSON string.");
    process.exit(1);
  }
  const result = await api("POST", `/api/experiments/${projectId}/experiment-run`, {
    slug,
    inputData: flags.inputData,
  });
  console.log(JSON.stringify(result, null, 2));
}

async function saveResult(projectId: string, slug: string, flags: Record<string, string>) {
  if (!flags.analysisResult) {
    console.error("--analysisResult is required (JSON string from Bayesian analysis).");
    process.exit(1);
  }
  try { JSON.parse(flags.analysisResult); } catch {
    console.error("--analysisResult must be a valid JSON string.");
    process.exit(1);
  }
  const result = await api("POST", `/api/experiments/${projectId}/experiment-run`, {
    slug,
    analysisResult: flags.analysisResult,
  });
  console.log(JSON.stringify(result, null, 2));
}

async function recordDecision(projectId: string, slug: string, flags: Record<string, string>) {
  if (!flags.decision) {
    console.error("--decision is required.");
    console.error(`Valid values: ${[...VALID_DECISIONS].join(" | ")}`);
    process.exit(1);
  }
  requireEnum(flags.decision, VALID_DECISIONS, "decision");
  if (!flags.decisionSummary) {
    console.error("--decisionSummary is required (plain-language action).");
    process.exit(1);
  }
  const body: Record<string, unknown> = {
    slug,
    decision: flags.decision,
    decisionSummary: flags.decisionSummary,
  };
  if (flags.decisionReason) body.decisionReason = flags.decisionReason;
  const result = await api("POST", `/api/experiments/${projectId}/experiment-run`, body);
  console.log(JSON.stringify(result, null, 2));
}

async function saveLearning(projectId: string, slug: string, flags: Record<string, string>) {
  const LEARNING_FIELDS = ["whatChanged", "whatHappened", "confirmedOrRefuted", "whyItHappened", "nextHypothesis"];
  const body: Record<string, unknown> = { slug };
  for (const field of LEARNING_FIELDS) {
    if (flags[field]) body[field] = flags[field];
  }
  if (Object.keys(body).length === 1) {
    console.error(`At least one learning field is required: ${LEARNING_FIELDS.join(", ")}`);
    process.exit(1);
  }
  const result = await api("POST", `/api/experiments/${projectId}/experiment-run`, body);
  console.log(JSON.stringify(result, null, 2));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const [command, ...rest] = process.argv.slice(2);

  switch (command) {
    case "get-project": {
      const [projectId] = rest;
      if (!projectId) { console.error("Usage: sync.ts get-project <project-id>"); process.exit(1); }
      await getProject(projectId);
      break;
    }
    case "update-state": {
      const [projectId, ...flagArgs] = rest;
      if (!projectId) { console.error("Usage: sync.ts update-state <project-id> --goal '...'"); process.exit(1); }
      await updateState(projectId, parseArgs(flagArgs));
      break;
    }
    case "set-stage": {
      const [projectId, stage] = rest;
      if (!projectId || !stage) { console.error(`Usage: sync.ts set-stage <project-id> <stage>\nValid: ${[...VALID_STAGES].join(" | ")}`); process.exit(1); }
      await setStage(projectId, stage);
      break;
    }
    case "add-activity": {
      const [projectId, ...flagArgs] = rest;
      if (!projectId) { console.error("Usage: sync.ts add-activity <project-id> --type <type> --title '...'"); process.exit(1); }
      await addActivity(projectId, parseArgs(flagArgs));
      break;
    }
    case "create-run": {
      const [projectId, slug, ...flagArgs] = rest;
      if (!projectId || !slug) { console.error("Usage: sync.ts create-run <project-id> <slug> [--field value ...]"); process.exit(1); }
      await createRun(projectId, slug, parseArgs(flagArgs));
      break;
    }
    case "start-run": {
      const [projectId, slug] = rest;
      if (!projectId || !slug) { console.error("Usage: sync.ts start-run <project-id> <slug>"); process.exit(1); }
      await setRunStatus(projectId, slug, "running");
      break;
    }
    case "pause-run": {
      const [projectId, slug] = rest;
      if (!projectId || !slug) { console.error("Usage: sync.ts pause-run <project-id> <slug>"); process.exit(1); }
      await setRunStatus(projectId, slug, "paused");
      break;
    }
    case "complete-run": {
      const [projectId, slug] = rest;
      if (!projectId || !slug) { console.error("Usage: sync.ts complete-run <project-id> <slug>"); process.exit(1); }
      await setRunStatus(projectId, slug, "completed");
      break;
    }
    case "save-input": {
      const [projectId, slug, ...flagArgs] = rest;
      if (!projectId || !slug) { console.error("Usage: sync.ts save-input <project-id> <slug> --inputData '<json>'"); process.exit(1); }
      await saveInput(projectId, slug, parseArgs(flagArgs));
      break;
    }
    case "save-result": {
      const [projectId, slug, ...flagArgs] = rest;
      if (!projectId || !slug) { console.error("Usage: sync.ts save-result <project-id> <slug> --analysisResult '<json>'"); process.exit(1); }
      await saveResult(projectId, slug, parseArgs(flagArgs));
      break;
    }
    case "record-decision": {
      const [projectId, slug, ...flagArgs] = rest;
      if (!projectId || !slug) { console.error("Usage: sync.ts record-decision <project-id> <slug> --decision CONTINUE --decisionSummary '...'"); process.exit(1); }
      await recordDecision(projectId, slug, parseArgs(flagArgs));
      break;
    }
    case "save-learning": {
      const [projectId, slug, ...flagArgs] = rest;
      if (!projectId || !slug) { console.error("Usage: sync.ts save-learning <project-id> <slug> --whatChanged '...' --whatHappened '...'"); process.exit(1); }
      await saveLearning(projectId, slug, parseArgs(flagArgs));
      break;
    }
    default: {
      console.error(`Unknown command: ${command ?? "(none)"}`);
      console.error("Commands:");
      console.error("  get-project     <projectId>");
      console.error("  update-state    <projectId> --<field> '<value>' ...");
      console.error("  set-stage       <projectId> <stage>");
      console.error("  add-activity    <projectId> --type <type> --title '<title>'");
      console.error("  create-run      <projectId> <slug> [--field value ...]");
      console.error("  start-run       <projectId> <slug>");
      console.error("  pause-run       <projectId> <slug>");
      console.error("  complete-run    <projectId> <slug>");
      console.error("  save-input      <projectId> <slug> --inputData '<json>'");
      console.error("  save-result     <projectId> <slug> --analysisResult '<json>'");
      console.error("  record-decision <projectId> <slug> --decision <DECISION> --decisionSummary '<text>'");
      console.error("  save-learning   <projectId> <slug> --whatChanged '<text>' ...");
      process.exit(1);
    }
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`sync.ts failed: ${message}`);
  process.exit(1);
});
