/** SDK payload format sent to cf-worker /api/track */
export interface TrackPayload {
  user: {
    keyId:       string;
    properties?: Record<string, string>;
  };
  variations?: Array<{
    flagKey:      string;
    variant:      string;
    timestamp:    number;        // epoch seconds
    experimentId?: string;
    layerId?:      string;
  }>;
  metrics?: Array<{
    eventName:    string;
    numericValue?: number;
    timestamp:    number;        // epoch seconds
  }>;
}

export interface ExperimentQueryRequest {
  envId:       string;
  flagKey:     string;
  metricEvent: string;
  dates:       string[];        // ["YYYY-MM-DD"]
}

export interface VariantStats {
  users:          number;
  conversions:    number;
  conversionRate: number;
  totalValue:     number;
  avgValue:       number;
}

/** Response keyed by variant name */
export type ExperimentQueryResponse = Record<string, VariantStats>;
