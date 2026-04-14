/** Replace chars that are not word chars or hyphens with '_'. */
export function sanitize(s: string): string {
  return s.replace(/[^\w-]/g, "_");
}

export function toDateString(tsMs: number): string {
  return new Date(tsMs).toISOString().slice(0, 10);
}

// ── Delta paths (written by DO, consumed by rollup-service) ──────────────────

export function flagEvalDeltaPrefix(envId: string, flagKey: string, date: string): string {
  return `deltas/flag-evals/${sanitize(envId)}/${sanitize(flagKey)}/${date}/`;
}

export function metricEventDeltaPrefix(envId: string, eventName: string, date: string): string {
  return `deltas/metric-events/${sanitize(envId)}/${sanitize(eventName)}/${date}/`;
}

export function flagEvalDeltaKey(envId: string, flagKey: string, date: string, ts: number): string {
  return `${flagEvalDeltaPrefix(envId, flagKey, date)}${ts}.json`;
}

export function metricEventDeltaKey(envId: string, eventName: string, date: string, ts: number): string {
  return `${metricEventDeltaPrefix(envId, eventName, date)}${ts}.json`;
}

// ── Rollup paths (written by rollup-service, read by query endpoint) ──────────

export function flagEvalRollupKey(envId: string, flagKey: string, date: string): string {
  return `rollups/flag-evals/${sanitize(envId)}/${sanitize(flagKey)}/${date}.json`;
}

export function metricEventRollupKey(envId: string, eventName: string, date: string): string {
  return `rollups/metric-events/${sanitize(envId)}/${sanitize(eventName)}/${date}.json`;
}

// ── Hash bucket (consistent with rollup-service C# implementation) ────────────

export function computeHashBucket(userKey: string, flagKey: string): number {
  let h = 0;
  const s = `${userKey}:${flagKey}`;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) >>> 0;
  }
  return h % 100;
}
