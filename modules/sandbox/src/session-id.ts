import { v5 as uuidv5 } from "uuid";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

/**
 * A fixed namespace UUID used to derive deterministic session IDs
 * from project IDs via UUID v5.
 */
const NAMESPACE = "a3f1b2c4-d5e6-4f78-9a0b-1c2d3e4f5a6b";

/** Persisted file so session state survives server restarts. */
const SESSIONS_FILE = join(process.cwd(), ".known-sessions.json");

/**
 * Convert a project ID string into a deterministic UUID v5.
 * The same project ID always produces the same session UUID,
 * so the SDK can resume the session across multiple HTTP calls.
 */
export function projectIdToSessionId(projectId: string): string {
  return uuidv5(projectId, NAMESPACE);
}

function loadSessions(): Set<string> {
  try {
    if (existsSync(SESSIONS_FILE)) {
      const data = JSON.parse(readFileSync(SESSIONS_FILE, "utf-8"));
      if (Array.isArray(data)) return new Set(data);
    }
  } catch { /* corrupted file → start fresh */ }
  return new Set();
}

function saveSessions(sessions: Set<string>): void {
  writeFileSync(SESSIONS_FILE, JSON.stringify([...sessions]), "utf-8");
}

/**
 * Track which session UUIDs have already been created with the SDK.
 * Persisted to disk so the server knows which sessions to resume
 * after a restart.
 */
const knownSessions = loadSessions();

export function isKnownSession(uuid: string): boolean {
  return knownSessions.has(uuid);
}

export function markSessionKnown(uuid: string): void {
  knownSessions.add(uuid);
  saveSessions(knownSessions);
}

export function unmarkSession(uuid: string): void {
  knownSessions.delete(uuid);
  saveSessions(knownSessions);
}
