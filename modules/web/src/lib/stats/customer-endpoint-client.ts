/**
 * Customer Managed Data Endpoint client.
 *
 * Public contract:  docs/customer-managed-data-endpoints-v1.md
 * Implementation:   docs/customer-managed-endpoints-implementation.md
 *
 * Outbound HTTP client that fetches per-experiment statistics from a
 * customer-hosted HTTPS endpoint. Handles:
 *
 *   - HMAC-SHA256 request signing (spec §5)
 *   - Request body construction in v1 schema shape (spec §3.2 / §3.3)
 *   - Timeout + retry with exponential backoff (spec §7.2)
 *   - Response normalisation: accepts either {n, mean, stddev} (recommended)
 *     or {n, sum, sum_squares} (legacy) for continuous metrics; both convert
 *     to the {n, mean, variance} shape that `metricMoments()` consumes
 *     directly (bayesian.ts:51-53).
 *   - SSRF guard at fetch time (rejects loopback, private IPv4 ranges,
 *     metadata-service IPs)
 *
 * Wired into the analyser by PR 5 (`analyze/route.ts`); also called by the
 * Test endpoint route to verify provider connectivity.
 */

import { createHmac, randomUUID } from "node:crypto";
import type { CustomerEndpointProvider } from "@/generated/prisma";

// ── Constants ────────────────────────────────────────────────────────────────

const SCHEMA_VERSION = 1;
const RETRY_DELAYS_MS = [1000, 4000];          // backoff between attempts
const RETRYABLE_STATUSES = new Set([503]);     // plus network errors (caught below)

// ── Public types ─────────────────────────────────────────────────────────────

export interface MetricSpec {
  name:    string;
  role:    "primary" | "guardrail" | "reward";
  type:    "binary" | "continuous";
  agg:     "once" | "count" | "sum" | "average";
  inverse?: boolean;
}

export interface StatsRequest {
  experimentMode: "ab" | "bandit";
  experimentId:   string;
  flagKey:        string;
  envId:          string;
  variants:       string[];
  windowStart:    string;          // ISO-8601
  windowEnd:      string;          // ISO-8601
  metrics:        MetricSpec[];
  staticParams?:  Record<string, unknown>;
}

/**
 * Per-variant stats normalised to the shape `metricMoments()` consumes.
 *
 *   binary     → { n, k }
 *   continuous → { n, mean, variance }      (variance = stddev² )
 *
 * This lets the analyser stay unchanged whether the customer returned
 * {n, mean, stddev} or {n, sum, sum_squares}.
 */
export type VariantStats =
  | { n: number; k: number }
  | { n: number; mean: number; variance: number };

export interface MetricStatsBlock {
  type: "binary" | "continuous";
  agg:  "once" | "count" | "sum" | "average";
  data: Record<string, VariantStats>;        // variantName → stats
}

export interface StatsResponse {
  schemaVersion: number;
  experimentId:  string;
  computedAt:    string;
  metrics:       Record<string, MetricStatsBlock>;
}

export type CallResult =
  | { ok: true;  response: StatsResponse; attempts: number }
  | { ok: false; error:    CallError;     attempts: number };

export interface CallError {
  kind:        "ssrf-blocked" | "network" | "http" | "timeout" | "invalid-json" | "schema";
  status?:     number;          // for "http"
  message:     string;
  body?:       unknown;         // raw error response body if any
  durationMs:  number;
}

// ── HMAC signing (spec §5) ───────────────────────────────────────────────────

/**
 * Build the signing string per spec §5: `${timestamp}.${rawBody}`.
 * Returns the hex signature for the `X-FeatBit-Signature` header (already
 * prefixed with `sha256=`).
 */
export function signRequest(
  signingSecret: string,
  timestampUnixSec: number,
  rawBody: string,
): string {
  const sig = createHmac("sha256", signingSecret)
    .update(`${timestampUnixSec}.${rawBody}`, "utf8")
    .digest("hex");
  return `sha256=${sig}`;
}

// ── SSRF guard ───────────────────────────────────────────────────────────────

/**
 * Reject hostnames that resolve (statically) to loopback, private, or
 * link-local addresses, including the IMDS metadata IP. Catches the obvious
 * attack vectors; does NOT defend against DNS rebinding (where a hostname
 * resolves to a public IP at validation time and a private IP at fetch time)
 * — that requires per-request DNS resolution + comparison, out of scope for v1.
 *
 * Operators who legitimately need to point at a private/loopback URL (dev
 * iteration, VPN-internal endpoints) can opt out by setting
 * ALLOW_PRIVATE_CUSTOMER_ENDPOINTS=1 in the environment.
 *
 * Returns null if URL is safe; an error string otherwise.
 */
export function checkPrivateAddress(urlString: string): string | null {
  if (process.env.ALLOW_PRIVATE_CUSTOMER_ENDPOINTS === "1") return null;

  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return "URL is malformed";
  }
  if (url.protocol !== "https:") return "URL must use https://";
  const host = url.hostname.toLowerCase();

  // Hostname-based blocklist
  if (host === "localhost" || host === "ip6-localhost" || host.endsWith(".local")) {
    return `host "${host}" is not a public address`;
  }

  // IPv6 loopback / link-local / unique-local
  if (host === "::1" || host === "[::1]") return "host is IPv6 loopback";
  if (host.startsWith("fe80:") || host.startsWith("[fe80:")) return "host is IPv6 link-local";
  if (host.startsWith("fc00:") || host.startsWith("fd00:") || host.startsWith("[fc00:") || host.startsWith("[fd00:")) {
    return "host is IPv6 unique-local";
  }

  // IPv4 dotted-quad detection
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 127) return "host is IPv4 loopback";
    if (a === 10)  return "host is IPv4 private (10.0.0.0/8)";
    if (a === 192 && b === 168) return "host is IPv4 private (192.168.0.0/16)";
    if (a === 172 && b >= 16 && b <= 31) return "host is IPv4 private (172.16.0.0/12)";
    if (a === 169 && b === 254) return "host is IPv4 link-local / metadata (169.254.0.0/16)";
    if (a === 0)   return "host is IPv4 unspecified (0.0.0.0/8)";
  }

  return null;
}

// ── Request body builder (spec §3.2) ─────────────────────────────────────────

function buildRequestBody(req: StatsRequest, requestId: string): {
  raw: string;
  parsed: Record<string, unknown>;
} {
  const parsed: Record<string, unknown> = {
    schemaVersion:  SCHEMA_VERSION,
    experimentMode: req.experimentMode,
    experimentId:   req.experimentId,
    flagKey:        req.flagKey,
    envId:          req.envId,
    variants:       req.variants,
    window:         { start: req.windowStart, end: req.windowEnd },
    metrics:        req.metrics,
  };
  if (req.staticParams) parsed.staticParams = req.staticParams;
  return { raw: JSON.stringify(parsed), parsed };
}

// ── Response normalisation ───────────────────────────────────────────────────

/**
 * Validate and normalise the response. Throws on schema violations so the
 * caller surfaces a single "schema" error kind rather than half-parsed data.
 */
export function normaliseResponse(raw: unknown): StatsResponse {
  if (!raw || typeof raw !== "object") {
    throw new Error("response is not a JSON object");
  }
  const r = raw as Record<string, unknown>;
  if (r.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`unsupported schemaVersion: ${String(r.schemaVersion)}`);
  }
  if (typeof r.experimentId !== "string") throw new Error("experimentId missing");
  if (typeof r.computedAt   !== "string") throw new Error("computedAt missing");
  if (!r.metrics || typeof r.metrics !== "object") throw new Error("metrics missing");

  const normMetrics: Record<string, MetricStatsBlock> = {};
  for (const [name, blockRaw] of Object.entries(r.metrics as Record<string, unknown>)) {
    if (!blockRaw || typeof blockRaw !== "object") {
      throw new Error(`metrics["${name}"] is not an object`);
    }
    const block = blockRaw as Record<string, unknown>;
    const type  = block.type;
    const agg   = block.agg;
    if (type !== "binary" && type !== "continuous") {
      throw new Error(`metrics["${name}"].type must be binary|continuous`);
    }
    if (agg !== "once" && agg !== "count" && agg !== "sum" && agg !== "average") {
      throw new Error(`metrics["${name}"].agg must be once|count|sum|average`);
    }
    if (!block.data || typeof block.data !== "object") {
      throw new Error(`metrics["${name}"].data missing`);
    }

    const data: Record<string, VariantStats> = {};
    for (const [variant, statsRaw] of Object.entries(block.data as Record<string, unknown>)) {
      data[variant] = normaliseVariantStats(name, variant, type, statsRaw);
    }
    normMetrics[name] = { type, agg, data };
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    experimentId:  r.experimentId,
    computedAt:    r.computedAt,
    metrics:       normMetrics,
  };
}

function normaliseVariantStats(
  metric:   string,
  variant:  string,
  type:     "binary" | "continuous",
  raw:      unknown,
): VariantStats {
  if (!raw || typeof raw !== "object") {
    throw new Error(`metrics["${metric}"].data["${variant}"] is not an object`);
  }
  const s = raw as Record<string, unknown>;
  const n = numberOrThrow(s.n, `metrics["${metric}"].data["${variant}"].n`);
  if (n < 0) throw new Error(`metrics["${metric}"].data["${variant}"].n must be ≥ 0`);

  if (type === "binary") {
    const k = numberOrThrow(s.k, `metrics["${metric}"].data["${variant}"].k`);
    return { n, k };
  }

  // continuous: prefer {mean, stddev} (recommended), fall back to {sum, sum_squares}.
  if ("stddev" in s || "mean" in s) {
    const mean   = numberOrThrow(s.mean,   `metrics["${metric}"].data["${variant}"].mean`);
    const stddev = numberOrThrow(s.stddev, `metrics["${metric}"].data["${variant}"].stddev`);
    return { n, mean, variance: stddev * stddev };
  }
  if ("sum" in s) {
    const sum = numberOrThrow(s.sum, `metrics["${metric}"].data["${variant}"].sum`);
    const ss  = numberOrThrow(s.sum_squares, `metrics["${metric}"].data["${variant}"].sum_squares`);
    if (n === 0) return { n: 0, mean: 0, variance: 0 };
    const mean = sum / n;
    const variance = n > 1 ? (ss - (sum * sum) / n) / (n - 1) : 0;
    return { n, mean, variance };
  }
  throw new Error(
    `metrics["${metric}"].data["${variant}"] missing required keys ` +
    `(continuous needs {n, mean, stddev} or {n, sum, sum_squares})`,
  );
}

function numberOrThrow(v: unknown, label: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new Error(`${label} must be a finite number, got ${JSON.stringify(v)}`);
  }
  return v;
}

// ── Single attempt ───────────────────────────────────────────────────────────

async function attempt(
  provider: Pick<CustomerEndpointProvider, "baseUrl" | "signingSecret" | "timeoutMs">,
  path: string,
  body: { raw: string; parsed: Record<string, unknown> },
  requestId: string,
): Promise<{ ok: true; response: StatsResponse } | { ok: false; error: CallError }> {
  const url = `${provider.baseUrl}${path}`;
  const ssrfErr = checkPrivateAddress(url);
  if (ssrfErr) {
    return {
      ok: false,
      error: { kind: "ssrf-blocked", message: ssrfErr, durationMs: 0 },
    };
  }

  const start = Date.now();
  const tsSec = Math.floor(start / 1000);
  const sig   = signRequest(provider.signingSecret, tsSec, body.raw);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type":         "application/json",
        "X-FeatBit-Schema":     String(SCHEMA_VERSION),
        "X-FeatBit-Timestamp":  String(tsSec),
        "X-FeatBit-Signature":  sig,
        "X-FeatBit-Request-Id": requestId,
        "User-Agent":           "FeatBit-Analysis/1.x",
      },
      body:   body.raw,
      signal: AbortSignal.timeout(provider.timeoutMs),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isTimeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return {
      ok: false,
      error: {
        kind: isTimeout ? "timeout" : "network",
        message,
        durationMs: Date.now() - start,
      },
    };
  }

  const durationMs = Date.now() - start;

  if (!res.ok) {
    let errBody: unknown = undefined;
    try { errBody = await res.json(); } catch { errBody = await res.text().catch(() => undefined); }
    return {
      ok: false,
      error: {
        kind: "http",
        status: res.status,
        message: `${res.status} ${res.statusText}`,
        body: errBody,
        durationMs,
      },
    };
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: "invalid-json",
        message: err instanceof Error ? err.message : String(err),
        durationMs,
      },
    };
  }

  try {
    return { ok: true, response: normaliseResponse(json) };
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: "schema",
        message: err instanceof Error ? err.message : String(err),
        body: json,
        durationMs,
      },
    };
  }
}

// ── Public entry: callCustomerEndpoint (with retries) ────────────────────────

/**
 * Call the customer endpoint with timeout + retry per spec §7.2.
 *
 * Retries on HTTP 503 + network errors only. Schema violations, 4xx, ssrf-block
 * fail immediately (retrying won't help). Total attempts = 1 + RETRY_DELAYS_MS.length.
 */
export async function callCustomerEndpoint(
  provider: Pick<CustomerEndpointProvider, "baseUrl" | "signingSecret" | "timeoutMs">,
  path: string,
  request: StatsRequest,
): Promise<CallResult> {
  const requestId = randomUUID();
  const body = buildRequestBody(request, requestId);

  const maxAttempts = 1 + RETRY_DELAYS_MS.length;
  let last: { ok: true; response: StatsResponse } | { ok: false; error: CallError } | null = null;

  for (let i = 0; i < maxAttempts; i++) {
    last = await attempt(provider, path, body, requestId);
    if (last.ok) return { ok: true, response: last.response, attempts: i + 1 };
    const retriable =
      last.error.kind === "network" ||
      (last.error.kind === "http" && last.error.status !== undefined && RETRYABLE_STATUSES.has(last.error.status));
    if (!retriable) return { ok: false, error: last.error, attempts: i + 1 };
    if (i < RETRY_DELAYS_MS.length) {
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[i]));
    }
  }

  // Exhausted retries
  return last as CallResult;
}

// ── Public entry: pingCustomerEndpoint (Test button) ─────────────────────────

/**
 * Send a fixed sample request to verify provider connectivity, signing, and
 * handler wiring. Per spec §8: experimentId="featbit-ping", metrics=[].
 *
 * The ping is sent to `baseUrl` directly (no path appended). The customer's
 * root handler at baseUrl must recognise the magic experimentId and return
 * 200 with `{ schemaVersion: 1, experimentId: "featbit-ping", metrics: {} }`.
 */
export async function pingCustomerEndpoint(
  provider: Pick<CustomerEndpointProvider, "baseUrl" | "signingSecret" | "timeoutMs">,
): Promise<CallResult> {
  return callCustomerEndpoint(provider, "", {
    experimentMode: "ab",
    experimentId:   "featbit-ping",
    flagKey:        "featbit-ping",
    envId:          "featbit-ping",
    variants:       [],
    windowStart:    "1970-01-01T00:00:00Z",
    windowEnd:      "1970-01-01T00:00:00Z",
    metrics:        [],
  });
}
