import type { ActiveSession } from "./types.js";

// In-memory store: sessionId → ActiveSession
const sessions = new Map<string, ActiveSession>();

export function registerSession(session: ActiveSession): void {
  sessions.set(session.sessionId, session);
}

export function getSession(sessionId: string): ActiveSession | undefined {
  return sessions.get(sessionId);
}

export function removeSession(sessionId: string): void {
  sessions.delete(sessionId);
}

export function listSessions(): ActiveSession[] {
  return Array.from(sessions.values());
}
