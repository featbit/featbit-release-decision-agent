SELECT
  quantileExact(0.95)(latency_ms) AS p95_latency_ms
FROM decision_events
WHERE decision_key = {decision_key:String}
  AND variant = {variant:String}
  AND created_at >= {start:DateTime}
  AND created_at < {end:DateTime};
