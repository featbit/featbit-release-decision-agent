SELECT
  percentile_cont(0.95) WITHIN GROUP (ORDER BY {{latency_ms_column}}) AS p95_latency_ms
FROM {{table}}
WHERE {{decision_key_column}} = @decision_key
  AND {{variant_column}} = @variant
  AND {{created_at_column}} >= @start
  AND {{created_at_column}} < @end;
