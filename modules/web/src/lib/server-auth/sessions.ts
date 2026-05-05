import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { parseJwt } from "@/lib/featbit-auth/jwt";
import type { Profile } from "@/lib/featbit-auth/types";
import {
  bridgeFetch,
  mergeCookies,
  refreshFeatBitToken,
  type FeatBitCookie,
} from "./featbit-bridge";
import { SESSION_TTL_DAYS } from "./cookie";

export interface ServerSession {
  id: string;
  token: string;
  cookies: FeatBitCookie[];
  profile: Profile;
  workspaceId: string | null;
  organizationId: string | null;
  expiresAt: Date;
  refreshedAt: Date;
}

interface CreateSessionInput {
  token: string;
  cookies: FeatBitCookie[];
  profile: Profile;
  workspaceId?: string | null;
  organizationId?: string | null;
}

function newSessionId(): string {
  return randomBytes(32).toString("base64url");
}

function ttl(): Date {
  return new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
}

function rowToSession(row: {
  id: string;
  featbitToken: string;
  featbitCookies: unknown;
  profile: unknown;
  workspaceId: string | null;
  organizationId: string | null;
  expiresAt: Date;
  refreshedAt: Date;
}): ServerSession {
  return {
    id: row.id,
    token: row.featbitToken,
    cookies: (row.featbitCookies as FeatBitCookie[]) ?? [],
    profile: row.profile as Profile,
    workspaceId: row.workspaceId,
    organizationId: row.organizationId,
    expiresAt: row.expiresAt,
    refreshedAt: row.refreshedAt,
  };
}

export async function createSession(input: CreateSessionInput): Promise<ServerSession> {
  const id = newSessionId();
  const expiresAt = ttl();
  const row = await prisma.authSession.create({
    data: {
      id,
      featbitToken: input.token,
      featbitCookies: input.cookies as unknown as object,
      profile: input.profile as unknown as object,
      workspaceId: input.workspaceId ?? input.profile.workspaceId ?? null,
      organizationId: input.organizationId ?? null,
      expiresAt,
    },
  });
  return rowToSession(row);
}

export async function destroySession(id: string): Promise<void> {
  await prisma.authSession.deleteMany({ where: { id } });
}

export async function loadSessionById(id: string): Promise<ServerSession | null> {
  const row = await prisma.authSession.findUnique({ where: { id } });
  if (!row) return null;
  if (row.expiresAt.getTime() <= Date.now()) {
    await prisma.authSession.delete({ where: { id } }).catch(() => undefined);
    return null;
  }
  return rowToSession(row);
}

export async function updateSessionOrganization(
  id: string,
  organizationId: string | null,
): Promise<void> {
  await prisma.authSession.update({
    where: { id },
    data: { organizationId },
  });
}

// ── singleflight refresh ─────────────────────────────────────────────────────
// One refresh per session id at any moment; concurrent callers await the same
// promise.

const inflight = new Map<string, Promise<ServerSession | null>>();

const REFRESH_BUFFER_MS = 60_000; // refresh if <= 1 min remains

function tokenExpiresSoon(token: string): boolean {
  const claims = parseJwt(token);
  if (!claims?.exp) return true;
  return claims.exp * 1000 - Date.now() <= REFRESH_BUFFER_MS;
}

export async function refreshIfNeeded(session: ServerSession): Promise<ServerSession | null> {
  if (!tokenExpiresSoon(session.token)) return session;
  const existing = inflight.get(session.id);
  if (existing) return existing;
  const promise = doRefresh(session)
    .catch((err) => {
      // Network errors (fetch failed, ECONNREFUSED, etc.) should not crash the
      // page tree. Return the existing session so the user stays logged in; the
      // refresh will be retried on the next request.
      console.error("[refreshIfNeeded] token refresh failed, keeping stale session:", err);
      return session;
    })
    .finally(() => {
      inflight.delete(session.id);
    });
  inflight.set(session.id, promise);
  return promise;
}

async function doRefresh(session: ServerSession): Promise<ServerSession | null> {
  const result = await refreshFeatBitToken(session.cookies);
  if (!result.ok || !result.token) {
    // 401 means the refresh token itself is definitively rejected — destroy.
    // Any other failure (5xx, network hiccup caught before here, missing token
    // in an otherwise-ok response) is treated as transient: keep the existing
    // session so the user stays logged in and we retry on the next request.
    if (result.status === 401) {
      await destroySession(session.id).catch(() => undefined);
      return null;
    }
    console.error("[doRefresh] refresh failed with status", result.status, "— keeping stale session");
    return session;
  }
  const cookies = result.cookies ?? session.cookies;
  const row = await prisma.authSession.update({
    where: { id: session.id },
    data: {
      featbitToken: result.token,
      featbitCookies: cookies as unknown as object,
      refreshedAt: new Date(),
      expiresAt: ttl(),
    },
  });
  return rowToSession(row);
}

// ── helper used by login routes ──────────────────────────────────────────────

export async function fetchProfile(
  token: string,
  cookies: FeatBitCookie[],
): Promise<{ profile: Profile; cookies: FeatBitCookie[] }> {
  const res = await bridgeFetch("/user/profile", {
    method: "GET",
    token,
    cookies,
  });
  if (!res.ok) {
    throw new Error(`Failed to load profile: ${res.status}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(res.bodyText);
  } catch {
    throw new Error("Profile response was not JSON");
  }
  const profile = unwrap<Profile>(parsed);
  if (!profile?.id) throw new Error("Profile response missing id");
  return {
    profile,
    cookies: mergeCookies(cookies, res.setCookies),
  };
}

function unwrap<T>(parsed: unknown): T {
  if (parsed && typeof parsed === "object" && "success" in parsed) {
    const env = parsed as { success: boolean; data?: T };
    if (env.success) return env.data as T;
  }
  return parsed as T;
}
