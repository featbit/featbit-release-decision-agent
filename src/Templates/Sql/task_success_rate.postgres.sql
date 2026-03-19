SELECT
  SUM(CASE WHEN success THEN 1 ELSE 0 END)::double precision / NULLIF(COUNT(DISTINCT task_id), 0) AS task_success_rate
FROM {{table}}
WHERE decision_key = @decision_key
  AND variant = @variant
  AND created_at >= @start
  AND created_at < @end;
