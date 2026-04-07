/**
 * db-client.ts — HTTP API wrapper for reading/writing experiment data via the web app DB.
 *
 * All experiment scripts use this module instead of reading/writing local files.
 * The web app exposes REST endpoints; this module wraps them.
 *
 * Environment:
 *   SYNC_API_URL — base URL of the web app (default: http://localhost:3000)
 */

const API_BASE = process.env.SYNC_API_URL ?? "http://localhost:3000";

// ── Types ────────────────────────────────────────────────────────────────────

export interface Experiment {
  id: string;
  projectId: string;
  slug: string;
  status: string;
  hypothesis: string | null;
  method: string | null;
  methodReason: string | null;
  primaryMetricEvent: string | null;
  metricDescription: string | null;
  guardrailEvents: string | null; // JSON array string
  guardrailDescriptions: string | null;
  controlVariant: string | null;
  treatmentVariant: string | null;
  minimumSample: number | null;
  observationStart: string | null;
  observationEnd: string | null;
  priorProper: boolean;
  priorMean: number | null;
  priorStddev: number | null;
  inputData: string | null; // JSON string
  analysisResult: string | null; // JSON string
  decision: string | null;
  decisionSummary: string | null;
  decisionReason: string | null;
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────

async function api<T>(
  method: string,
  path: string,
  body?: Record<string, unknown>
): Promise<T> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`API ${method} ${path} → ${res.status}: ${JSON.stringify(data)}`);
  }
  return data as T;
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function getExperiment(
  projectId: string,
  slug: string
): Promise<Experiment> {
  return api<Experiment>(
    "GET",
    `/api/projects/${encodeURIComponent(projectId)}/experiment?slug=${encodeURIComponent(slug)}`
  );
}

export async function upsertExperiment(
  projectId: string,
  slug: string,
  data: Record<string, unknown>
): Promise<Experiment> {
  return api<Experiment>(
    "POST",
    `/api/projects/${encodeURIComponent(projectId)}/experiment`,
    { slug, ...data }
  );
}
