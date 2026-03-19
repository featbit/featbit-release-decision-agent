SELECT
  AVG(cost) AS avg_cost
FROM {{table}}
WHERE decision_key = @decision_key
  AND variant = @variant
  AND created_at >= @start
  AND created_at < @end;
