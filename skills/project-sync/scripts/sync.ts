#!/usr/bin/env npx tsx
/**
 * sync.ts — CLI tool for reading/writing project state via the web API.
 *
 * Usage:
 *   npx tsx sync.ts get-project <project-id>
 *   npx tsx sync.ts update-state <project-id> --goal "..." --hypothesis "..." --primaryMetric "..."
 *   npx tsx sync.ts set-stage <project-id> <stage>
 *   npx tsx sync.ts add-activity <project-id> --type stage_update --title "Intent clarified" [--detail "..."]
 *   npx tsx sync.ts upsert-experiment <project-id> <slug> --status running [--primaryMetricEvent "click_cta"] ...
 *
 * Environment:
 *   SYNC_API_URL — base URL of the web app (default: http://localhost:3000)
 */

const API_BASE = process.env.SYNC_API_URL ?? "http://localhost:3000";

// ── Helpers ──────────────────────────────────────────────────────────────────

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

// ── Commands ─────────────────────────────────────────────────────────────────

async function getProject(projectId: string) {
  const project = await api("GET", `/api/projects/${projectId}`, undefined, {
    exitOnError: false,
  });
  if (project === null) {
    // Return a blank-project placeholder so the agent can proceed
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
    process.exit(1);
  }
  const result = await api("PUT", `/api/projects/${projectId}/state`, flags);
  console.log(JSON.stringify(result, null, 2));
}

async function setStage(projectId: string, stage: string) {
  const result = await api("PUT", `/api/projects/${projectId}/stage`, { stage });
  console.log(JSON.stringify(result, null, 2));
}

async function addActivity(
  projectId: string,
  flags: Record<string, string>
) {
  const { type, title, detail } = flags;
  if (!type || !title) {
    console.error("--type and --title are required.");
    process.exit(1);
  }
  const result = await api("POST", `/api/projects/${projectId}/activity`, {
    type,
    title,
    detail,
  });
  console.log(JSON.stringify(result, null, 2));
}

async function upsertExperiment(
  projectId: string,
  slug: string,
  flags: Record<string, string>
) {
  // Convert numeric fields
  const body: Record<string, unknown> = { slug };
  for (const [key, value] of Object.entries(flags)) {
    if (key === "minimumSample") {
      body[key] = parseInt(value, 10);
    } else if (key === "priorProper") {
      body[key] = value === "true" || value === "1";
    } else if (key === "priorMean" || key === "priorStddev") {
      body[key] = parseFloat(value);
    } else if (key === "observationStart" || key === "observationEnd") {
      body[key] = new Date(value);
    } else {
      body[key] = value;
    }
  }
  const result = await api("POST", `/api/projects/${projectId}/experiment`, body);
  console.log(JSON.stringify(result, null, 2));
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const [command, ...rest] = process.argv.slice(2);

  switch (command) {
    case "get-project": {
      const projectId = rest[0];
      if (!projectId) {
        console.error("Usage: sync.ts get-project <project-id>");
        process.exit(1);
      }
      await getProject(projectId);
      break;
    }
    case "update-state": {
      const projectId = rest[0];
      if (!projectId) {
        console.error("Usage: sync.ts update-state <project-id> --goal '...' --intent '...'");
        process.exit(1);
      }
      const flags = parseArgs(rest.slice(1));
      await updateState(projectId, flags);
      break;
    }
    case "set-stage": {
      const projectId = rest[0];
      const stage = rest[1];
      if (!projectId || !stage) {
        console.error("Usage: sync.ts set-stage <project-id> <stage>");
        process.exit(1);
      }
      await setStage(projectId, stage);
      break;
    }
    case "add-activity": {
      const projectId = rest[0];
      if (!projectId) {
        console.error("Usage: sync.ts add-activity <project-id> --type '...' --title '...'");
        process.exit(1);
      }
      const flags = parseArgs(rest.slice(1));
      await addActivity(projectId, flags);
      break;
    }
    case "upsert-experiment": {
      const projectId = rest[0];
      const slug = rest[1];
      if (!projectId || !slug) {
        console.error("Usage: sync.ts upsert-experiment <project-id> <slug> --status running ...");
        process.exit(1);
      }
      const flags = parseArgs(rest.slice(2));
      await upsertExperiment(projectId, slug, flags);
      break;
    }
    default:
      console.error(`Unknown command: ${command}`);
      console.error("Commands: get-project, update-state, set-stage, add-activity, upsert-experiment");
      process.exit(1);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`sync.ts failed: ${message}`);
  process.exit(1);
});
