/** One custom metric event (conversion record). */
export interface MetricEventRecord {
  envId: string;
  eventName: string;
  userKey: string;
  numericValue: number | null;
  timestamp: number; // unix ms
  sessionId: string | null;
  source: string | null;
}

export function createMetricEventRecord(
  envId: string,
  eventName: string,
  userKey: string,
  timestampMs: number,
  numericValue?: number | null,
  source?: string | null,
): MetricEventRecord {
  return {
    envId,
    eventName,
    userKey,
    numericValue: numericValue ?? null,
    timestamp: timestampMs,
    sessionId: null,
    source: source ?? null,
  };
}
