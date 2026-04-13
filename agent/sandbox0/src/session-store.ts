/**
 * session-store.ts
 *
 * Persists agent, skill, and session IDs to .sessions.json.
 *
 * Schema:
 *   {
 *     agent:    { agentId, agentVersion, environmentId },
 *     skills:   { [skillName]: skillId },
 *     sessions: { [projectId]: { sessionId, createdAt, lastActiveAt } }
 *   }
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORE_PATH = resolve(__dirname, "..", ".sessions.json");

interface AgentEntry {
  agentId: string;
  agentVersion: number;
  environmentId: string;
}

interface SessionEntry {
  sessionId: string;
  createdAt: string;
  lastActiveAt: string;
}

interface Store {
  agent?: AgentEntry;
  skills?: Record<string, string>; // skillName → skillId
  sessions: Record<string, SessionEntry>;
}

function load(): Store {
  if (!existsSync(STORE_PATH)) return { sessions: {} };
  try {
    return JSON.parse(readFileSync(STORE_PATH, "utf-8")) as Store;
  } catch {
    return { sessions: {} };
  }
}

function save(store: Store): void {
  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), "utf-8");
}

// ── Agent + Environment ───────────────────────────────────────────────────────

export function getSavedAgent(): AgentEntry | null {
  return load().agent ?? null;
}

export function saveAgent(entry: AgentEntry): void {
  const store = load();
  store.agent = entry;
  save(store);
}

// ── Skills ────────────────────────────────────────────────────────────────────

export function getSavedSkills(): Record<string, string> | null {
  return load().skills ?? null;
}

export function saveSkills(skills: Record<string, string>): void {
  const store = load();
  store.skills = skills;
  save(store);
}

// ── Sessions ──────────────────────────────────────────────────────────────────

export function getSavedSession(projectId: string): string | null {
  return load().sessions[projectId]?.sessionId ?? null;
}

export function saveSession(projectId: string, sessionId: string): void {
  const store = load();
  store.sessions[projectId] = {
    sessionId,
    createdAt: store.sessions[projectId]?.createdAt ?? new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
  };
  save(store);
}

export function clearSession(projectId: string): void {
  const store = load();
  delete store.sessions[projectId];
  save(store);
}

export function listSessions(): Record<string, SessionEntry> {
  return load().sessions;
}
