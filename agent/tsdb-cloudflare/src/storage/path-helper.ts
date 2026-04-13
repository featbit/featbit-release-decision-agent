/**
 * R2 key construction and date-range helpers.
 * Mirrors .NET PathHelper — translates filesystem paths to R2 object key prefixes.
 */

/** Replace any char that is not word char or hyphen with '_'. */
export function sanitize(input: string): string {
  return input.replace(/[^\w-]/g, "_");
}

// ── Partition key (prefix) builders ───────────────────────────────────────────

export function flagEvalPrefix(envId: string, flagKey: string, date: string): string {
  return `flag-evals/${sanitize(envId)}/${sanitize(flagKey)}/${date}/`;
}

export function metricEventPrefix(envId: string, eventName: string, date: string): string {
  return `metric-events/${sanitize(envId)}/${sanitize(eventName)}/${date}/`;
}

// ── Date range enumeration ────────────────────────────────────────────────────

/** Generate all yyyy-MM-dd strings in [startDate, endDate] inclusive. */
export function dateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const start = new Date(startDate + "T00:00:00Z");
  const end = new Date(endDate + "T00:00:00Z");

  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

/** List all R2 prefixes for flag-eval segments across a date range. */
export function flagEvalPrefixes(
  envId: string, flagKey: string, startDate: string, endDate: string,
): string[] {
  return dateRange(startDate, endDate).map(d => flagEvalPrefix(envId, flagKey, d));
}

/** List all R2 prefixes for metric-event segments across a date range. */
export function metricEventPrefixes(
  envId: string, eventName: string, startDate: string, endDate: string,
): string[] {
  return dateRange(startDate, endDate).map(d => metricEventPrefix(envId, eventName, d));
}

// ── Rollup paths ──────────────────────────────────────────────────────────────

export function flagEvalRollupKey(envId: string, flagKey: string, date: string): string {
  return `rollups/flag-evals/${sanitize(envId)}/${sanitize(flagKey)}/${date}.json`;
}

export function metricEventRollupKey(envId: string, eventName: string, date: string): string {
  return `rollups/metric-events/${sanitize(envId)}/${sanitize(eventName)}/${date}.json`;
}

export function flagEvalRollupPrefix(envId: string, flagKey: string): string {
  return `rollups/flag-evals/${sanitize(envId)}/${sanitize(flagKey)}/`;
}

export function metricEventRollupPrefix(envId: string, eventName: string): string {
  return `rollups/metric-events/${sanitize(envId)}/${sanitize(eventName)}/`;
}
