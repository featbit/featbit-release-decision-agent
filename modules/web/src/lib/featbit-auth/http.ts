import { FEATBIT_PROXY_PREFIX } from "./config";
import { authStorage } from "./storage";
import type { ApiEnvelope } from "./types";

export class FeatBitApiError extends Error {
  readonly status: number;
  readonly errors: string[];

  constructor(message: string, status: number, errors: string[] = []) {
    super(message);
    this.name = "FeatBitApiError";
    this.status = status;
    this.errors = errors;
  }
}

interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Kept for source compatibility — has no effect now that token lives server-side. */
  skipAuth?: boolean;
  raw?: boolean;
}

function buildUrl(path: string, query?: RequestOptions["query"]) {
  const base = path.startsWith("http")
    ? path
    : `${FEATBIT_PROXY_PREFIX}${path.startsWith("/") ? path : `/${path}`}`;
  if (!query) return base;
  const qs = new URLSearchParams();
  Object.entries(query).forEach(([k, v]) => {
    if (v !== undefined && v !== null) qs.append(k, String(v));
  });
  const s = qs.toString();
  return s ? `${base}${base.includes("?") ? "&" : "?"}${s}` : base;
}

// ── Session-expired event bus ────────────────────────────────────────────────
// Emitted when a same-origin request returns 401 — meaning the server-side
// session has been destroyed (FeatBit refresh failed, admin logged us out, etc.).

export const SESSION_EXPIRED_EVENT = "featbit:session-expired";

function emitSessionExpired() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
}

// Kept for source compatibility with components that imported it. Refresh now
// happens server-side; the browser has nothing to do here.
export async function refreshAccessToken(): Promise<boolean> {
  return true;
}

function contextHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const out: Record<string, string> = {};
  const org = authStorage.getOrganization();
  if (org?.id) out["Organization"] = org.id;
  const profile = authStorage.getProfile();
  if (profile?.workspaceId) out["Workspace"] = profile.workspaceId;
  return out;
}

export async function apiRequest<T = unknown>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { body, query, raw, headers, ...rest } = options;
  const url = buildUrl(path, query);

  const init: RequestInit = {
    ...rest,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...contextHeaders(),
      ...(headers || {}),
    },
  };
  if (body !== undefined) {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
  }

  const response = await fetch(url, init);

  if (response.status === 401) {
    emitSessionExpired();
  }

  const text = await response.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!response.ok) {
    const errors =
      (parsed as ApiEnvelope<unknown>)?.errors ??
      (typeof parsed === "string" ? [parsed] : []);
    const message =
      errors?.[0] || `${response.status} ${response.statusText || "Error"}`;
    throw new FeatBitApiError(message, response.status, errors);
  }

  if (raw) return parsed as T;

  if (parsed && typeof parsed === "object" && "success" in parsed) {
    const envelope = parsed as ApiEnvelope<T>;
    if (envelope.success === false) {
      throw new FeatBitApiError(
        envelope.errors?.[0] || "Request failed",
        response.status,
        envelope.errors || [],
      );
    }
    return envelope.data as T;
  }

  return parsed as T;
}
