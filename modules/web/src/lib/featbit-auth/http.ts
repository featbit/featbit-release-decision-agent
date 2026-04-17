import { FEATBIT_API_V1 } from "./config";
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
  skipAuth?: boolean;
  raw?: boolean;
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

export async function apiRequest<T = unknown>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { body, query, skipAuth, raw, headers, ...rest } = options;
  const url = buildUrl(path, query);
  const init: RequestInit = {
    ...rest,
    headers: { ...buildHeaders(skipAuth), ...(headers || {}) },
  };
  if (body !== undefined) {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
  }

  const response = await fetch(url, init);

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
