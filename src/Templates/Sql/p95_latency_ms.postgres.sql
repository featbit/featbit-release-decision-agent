SELECT
  percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95_latency_ms
FROM {{table}}
WHERE decision_key = @decision_key
  AND variant = @variant
  AND created_at >= @start
  AND created_at < @end;
