import { FEATBIT_API_V1 } from "./config";
import { authStorage } from "./storage";
import type { ApiEnvelope, LoginToken } from "./types";

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
  skipAuth?: boolean;
  raw?: boolean;
  /** Internal — set when this request is already a retry after refresh. Prevents loops. */
  _isRetry?: boolean;
  /** Internal — include credentials (for refresh endpoint). */
  _withCredentials?: boolean;
}

function buildUrl(
  path: string,
  query?: RequestOptions["query"],
) {
  const base = path.startsWith("http")
    ? path
    : `${FEATBIT_API_V1}${path.startsWith("/") ? path : `/${path}`}`;
  if (!query) return base;
  const qs = new URLSearchParams();
  Object.entries(query).forEach(([k, v]) => {
    if (v !== undefined && v !== null) qs.append(k, String(v));
  });
  const s = qs.toString();
  return s ? `${base}${base.includes("?") ? "&" : "?"}${s}` : base;
}

function buildHeaders(skipAuth?: boolean): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  if (!skipAuth && typeof window !== "undefined") {
    const token = authStorage.getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const org = authStorage.getOrganization();
    if (org?.id) headers["Organization"] = org.id;
    const profile = authStorage.getProfile();
    if (profile?.workspaceId) headers["Workspace"] = profile.workspaceId;
  }
  return headers;
}

// ── Session-expired event bus ────────────────────────────────────────────────
// Emitted after a request fails with 401 AND the refresh attempt also failed.
// UI layers (AuthGuard etc.) listen to decide whether to prompt re-auth.

export const SESSION_EXPIRED_EVENT = "featbit:session-expired";

function emitSessionExpired() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
}

// ── Silent refresh (singleflight) ────────────────────────────────────────────
// Only one refresh is in-flight at a time; concurrent 401s wait on the same promise.

let refreshInflight: Promise<boolean> | null = null;

async function doRefresh(): Promise<boolean> {
  const url = buildUrl("/identity/refresh-token");
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Accept: "application/json" },
      credentials: "include",
    });
    if (!res.ok) return false;
    const text = await res.text();
    if (!text) return false;
    let parsed: ApiEnvelope<LoginToken> | LoginToken;
    try {
      parsed = JSON.parse(text);
    } catch {
      return false;
    }
    const data =
      "success" in parsed && parsed.success
        ? (parsed.data as LoginToken | undefined)
        : (parsed as LoginToken);
    if (!data?.token) return false;
    authStorage.setToken(data.token);
    return true;
  } catch {
    return false;
  }
}

export function refreshAccessToken(): Promise<boolean> {
  if (refreshInflight) return refreshInflight;
  refreshInflight = doRefresh().finally(() => {
    refreshInflight = null;
  });
  return refreshInflight;
}

// ── Main request function ────────────────────────────────────────────────────

export async function apiRequest<T = unknown>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const {
    body,
    query,
    skipAuth,
    raw,
    headers,
    _isRetry,
    _withCredentials,
    ...rest
  } = options;
  const url = buildUrl(path, query);
  const init: RequestInit = {
    ...rest,
    headers: { ...buildHeaders(skipAuth), ...(headers || {}) },
  };
  if (_withCredentials) {
    init.credentials = "include";
  }
  if (body !== undefined) {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
  }

  const response = await fetch(url, init);

  // 401 on an authenticated request → try refresh once, then retry.
  if (response.status === 401 && !skipAuth && !_isRetry) {
    const ok = await refreshAccessToken();
    if (ok) {
      return apiRequest<T>(path, { ...options, _isRetry: true });
    }
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
