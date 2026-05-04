import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getSession } from "./require";
import type { ServerSession } from "./sessions";

// ── Token format ─────────────────────────────────────────────────────────────
// Plaintext: "fbat_" + 32 base64url chars (192 bits of entropy).
// Storage:   SHA-256(plaintext) hex (64 chars). Hash compares are constant
//            time at the DB-index layer; we never compare plaintexts.
// Display:   first 12 chars of the plaintext are stored as `prefix` so the
//            UI can show "fbat_abc123…" without leaking the secret.

export const TOKEN_PLAINTEXT_PREFIX = "fbat_";
const TOKEN_PLAINTEXT_LENGTH = TOKEN_PLAINTEXT_PREFIX.length + 32;

export function hashAgentToken(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex");
}

export function tokenPrefix(plaintext: string): string {
  return plaintext.slice(0, 12);
}

function isWellFormedToken(value: string): boolean {
  return (
    value.length === TOKEN_PLAINTEXT_LENGTH &&
    value.startsWith(TOKEN_PLAINTEXT_PREFIX)
  );
}

// ── Auth context ─────────────────────────────────────────────────────────────

export type AuthContext =
  | { kind: "session"; session: ServerSession }
  | { kind: "agent"; tokenId: string; projectKey: string };

function unauthorized(): NextResponse {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function forbidden(): NextResponse {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

function extractBearer(req: Request): string | null {
  const raw = req.headers.get("authorization");
  if (!raw) return null;
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return match ? match[1].trim() : null;
}

async function lookupAgentToken(
  bearer: string,
): Promise<{ id: string; projectKey: string } | null> {
  if (!isWellFormedToken(bearer)) return null;
  const hash = hashAgentToken(bearer);
  const row = await prisma.agentToken.findUnique({
    where: { tokenHash: hash },
    select: { id: true, projectKey: true, revokedAt: true },
  });
  if (!row || row.revokedAt) return null;
  // Fire-and-forget — don't block the request on the audit write.
  prisma.agentToken
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);
  return { id: row.id, projectKey: row.projectKey };
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Routes called only from the browser: must have a valid fb_session. */
export async function requireAuth(): Promise<ServerSession | NextResponse> {
  const session = await getSession();
  if (!session) return unauthorized();
  return session;
}

/**
 * Routes hit both by the browser and by headless agents (sync.ts running
 * inside a local Claude Code agent, etc.). Accepts either a valid fb_session
 * or a Bearer agent token. The handler must still verify the resource's
 * project scope when kind === "agent" (use `requireAuthForExperiment`
 * for the common case).
 */
export async function requireAuthOrAgent(
  req: Request,
): Promise<AuthContext | NextResponse> {
  const bearer = extractBearer(req);
  if (bearer) {
    const tok = await lookupAgentToken(bearer);
    if (tok) {
      return { kind: "agent", tokenId: tok.id, projectKey: tok.projectKey };
    }
    // Bearer was provided but didn't resolve — fail closed rather than
    // silently falling back to cookie auth, so a stolen-but-revoked token
    // can't ride along with an unrelated session.
    return unauthorized();
  }
  const session = await getSession();
  if (session) return { kind: "session", session };
  return unauthorized();
}

/**
 * Convenience for routes scoped to a specific experiment id. Resolves auth
 * AND verifies that an agent caller's projectKey matches the experiment's
 * featbitProjectKey (sessions are not project-scoped — they're user-scoped
 * within the FeatBit backend, so we trust the FeatBit upstream to enforce
 * any cross-project boundary on session traffic).
 */
export async function requireAuthForExperiment(
  req: Request,
  experimentId: string,
): Promise<AuthContext | NextResponse> {
  const auth = await requireAuthOrAgent(req);
  if (auth instanceof NextResponse) return auth;
  if (auth.kind === "agent") {
    const exp = await prisma.experiment.findUnique({
      where: { id: experimentId },
      select: { featbitProjectKey: true },
    });
    // Don't leak existence to a wrong-project agent — return 403 in both
    // "experiment doesn't exist" and "exists but wrong project" cases.
    if (!exp || exp.featbitProjectKey !== auth.projectKey) {
      return forbidden();
    }
  }
  return auth;
}
