import { cache } from "react";
import { getSessionCookie } from "./cookie";
import { loadSessionById, refreshIfNeeded, type ServerSession } from "./sessions";

/**
 * Load and (if needed) refresh the current request's session. Returns null
 * for unauthenticated requests. Memoised per request via React.cache so the
 * RSC tree only hits Postgres once.
 *
 * DB connection failures (e.g. Azure PostgreSQL unreachable) are caught and
 * treated as "no session" so the marketing/public pages still render instead
 * of surfacing a 500.
 */
export const getSession = cache(async (): Promise<ServerSession | null> => {
  const id = await getSessionCookie();
  if (!id) return null;
  try {
    const loaded = await loadSessionById(id);
    if (!loaded) return null;
    return refreshIfNeeded(loaded);
  } catch (err) {
    // Swallow transient DB errors (network partition, cold-start timeout, etc.)
    // so the rest of the page tree can still render in an unauthenticated state.
    console.error("[getSession] database unreachable, treating as unauthenticated:", err);
    return null;
  }
});

export async function requireSession(): Promise<ServerSession> {
  const session = await getSession();
  if (!session) {
    throw new UnauthorizedError();
  }
  return session;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("Unauthorized");
    this.name = "UnauthorizedError";
  }
}
