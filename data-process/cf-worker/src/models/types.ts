// ── SDK payload (incoming from client) ───────────────────────────────────────

export interface TrackPayload {
  user: {
    keyId: string;
    properties?: Record<string, string>;
  };
  variations?: Array<{
    flagKey: string;
    variant: string;
    timestamp: number;       // epoch seconds (SDK convention)
    experimentId?: string;
    layerId?: string;
  }>;
  metrics?: Array<{
    eventName: string;
    numericValue?: number;
    timestamp: number;       // epoch seconds
    type?: string;
  }>;
}

// ── Internal records ──────────────────────────────────────────────────────────

export interface FlagEvalRecord {
  envId: string;
  flagKey: string;
  userKey: string;
  variant: string;
  timestamp: number;         // epoch ms
  experimentId: string | null;
  layerId: string | null;
  hashBucket: number;        // 0–99
}

export interface MetricEventRecord {
  envId: string;
  eventName: string;
  userKey: string;
  numericValue: number | null;
  timestamp: number;         // epoch ms
}

// ── Rollup entry formats (stored in R2 as JSON arrays for compactness) ────────

/** [timestamp, variant, experimentId|null, layerId|null, hashBucket] */
export type FlagEvalEntry = [number, string, string | null, string | null, number];

/** [hasConversion(0|1), firstTs, firstVal|null, latestTs, latestVal|null, sum, count] */
export type MetricEntry = [0 | 1, number, number | null, number, number | null, number, number];

export interface FlagEvalRollup {
  v: 1;
  u: Record<string, FlagEvalEntry>;
}

export interface MetricEventRollup {
  v: 1;
  u: Record<string, MetricEntry>;
}

// ── Partition config (stored in DO) ───────────────────────────────────────────

export interface PartitionConfig {
  table: "flag-eval" | "metric-event";
  envId: string;
  key: string;               // flagKey or eventName
  date: string;              // "YYYY-MM-DD"
}

// ── Query API ─────────────────────────────────────────────────────────────────

export interface ExperimentQueryRequest {
  envId: string;
  flagKey: string;
  metricEvent: string;
  dates: string[];           // ["2026-04-01", "2026-04-02", ...]
}

export interface VariantStats {
  users: number;
  conversions: number;
  conversionRate: number;
  totalValue: number;
  avgValue: number;
}

export type ExperimentQueryResponse = Record<string, VariantStats>;
