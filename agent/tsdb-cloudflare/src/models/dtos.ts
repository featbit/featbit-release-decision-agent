// ── SDK track payload (matches .NET TrackPayload) ─────────────────────────────

export interface TrackPayload {
  user: EndUserDto;
  variations: FlagEvalDto[];
  metrics: MetricEventDto[];
}

export interface EndUserDto {
  keyId: string;
  name?: string;
  properties?: Record<string, string>;
}

export interface FlagEvalDto {
  flagKey: string;
  variant: string;
  sendToExperiment?: boolean;
  experimentId?: string;
  layerId?: string;
  timestamp: number; // unix seconds
}

export interface MetricEventDto {
  eventName: string;
  numericValue?: number | null;
  type?: string;
  route?: string;
  appType?: string;
  timestamp: number; // unix seconds
  props?: Record<string, unknown>;
}

// ── Query request / response DTOs ─────────────────────────────────────────────

export interface ExperimentQueryRequest {
  envId: string;
  flagKey: string;
  metricEvent: string;
  metricType: string; // binary | revenue | count | duration
  metricAgg?: string; // once | sum | mean | count | latest
  controlVariant: string;
  treatmentVariant: string;
  start: string; // ISO 8601
  end: string;   // ISO 8601
  experimentId?: string;
  layerId?: string;
  trafficPercent?: number;
  trafficOffset?: number;
  audienceFilters?: string; // JSON: AudienceFilter[]
  method?: string; // bayesian_ab | bandit
}

export interface ExperimentManyQueryRequest extends ExperimentQueryRequest {
  guardrailEvents?: string[];
}

export interface ExperimentQueryResponse {
  metricType: string;
  variants: Record<string, VariantStatsDto>;
}

export type ExperimentManyQueryResponse = Record<string, ExperimentQueryResponse>;

export interface VariantStatsDto {
  n: number;
  k?: number;        // binary only
  mean?: number;     // continuous only
  variance?: number; // continuous only
  total?: number;    // continuous only
}

// ── Exposure entry ────────────────────────────────────────────────────────────

export interface ExposureEntry {
  firstExposedAt: number; // unix ms
  variant: string;
}

// ── Audience filter ───────────────────────────────────────────────────────────

export interface AudienceFilter {
  property: string;
  op: "eq" | "neq" | "in" | "nin";
  value?: string;
  values?: string[];
}

export function audienceFilterMatches(
  filter: AudienceFilter,
  props: Record<string, string> | null,
): boolean {
  if (!props || !(filter.property in props)) {
    return filter.op === "neq" || filter.op === "nin";
  }
  const actual = props[filter.property];
  switch (filter.op) {
    case "eq":  return actual === filter.value;
    case "neq": return actual !== filter.value;
    case "in":  return filter.values?.includes(actual) === true;
    case "nin": return filter.values?.includes(actual) !== true;
    default:    return true;
  }
}

// ── Experiment query (internal) ───────────────────────────────────────────────

export interface ExperimentQuery {
  envId: string;
  flagKey: string;
  metricEvent: string;
  metricType: string;
  metricAgg: string;
  controlVariant: string;
  treatmentVariants: string[];
  allVariants: string[];
  startMs: number;
  endMs: number;
  startDate: string; // yyyy-MM-dd
  endDate: string;   // yyyy-MM-dd
  experimentId: string | null;
  layerId: string | null;
  trafficPercent: number;
  trafficOffset: number;
  audienceFilters: AudienceFilter[] | null;
  method: string;
}

export function buildExperimentQuery(req: ExperimentQueryRequest): ExperimentQuery {
  const start = new Date(req.start);
  const end = new Date(req.end);
  const treatments = [req.treatmentVariant];
  const audienceFilters = req.audienceFilters
    ? JSON.parse(req.audienceFilters) as AudienceFilter[]
    : null;

  return {
    envId: req.envId,
    flagKey: req.flagKey,
    metricEvent: req.metricEvent,
    metricType: req.metricType,
    metricAgg: req.metricAgg ?? "once",
    controlVariant: req.controlVariant,
    treatmentVariants: treatments,
    allVariants: [req.controlVariant, ...treatments],
    startMs: start.getTime(),
    endMs: end.getTime(),
    startDate: toDateString(start),
    endDate: toDateString(end),
    experimentId: req.experimentId ?? null,
    layerId: req.layerId ?? null,
    trafficPercent: req.trafficPercent ?? 100,
    trafficOffset: req.trafficOffset ?? 0,
    audienceFilters,
    method: req.method ?? "bayesian_ab",
  };
}

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}
