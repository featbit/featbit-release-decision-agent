import { v5 as uuidv5 } from "uuid";

/**
 * A fixed namespace UUID used to derive deterministic session IDs
 * from project IDs via UUID v5.
 */
const NAMESPACE = "a3f1b2c4-d5e6-4f78-9a0b-1c2d3e4f5a6b";

/**
 * Convert a project ID string into a deterministic UUID v5.
 * The same project ID always produces the same session UUID,
 * so the SDK can resume the session across multiple HTTP calls.
 */
export function projectIdToSessionId(projectId: string): string {
  return uuidv5(projectId, NAMESPACE);
}

/**
 * Track which session UUIDs have already been created with the SDK.
 * When a UUID is NOT in this set, we start a new session (SDK `sessionId`).
 * When it IS in the set, we resume the existing session (SDK `resume`).
 */
const knownSessions = new Set<string>();

export function isKnownSession(uuid: string): boolean {
  return knownSessions.has(uuid);
}

export function markSessionKnown(uuid: string): void {
  knownSessions.add(uuid);
}
