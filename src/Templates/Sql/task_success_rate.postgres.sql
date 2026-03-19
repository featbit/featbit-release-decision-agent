SELECT
  SUM(CASE WHEN {{success_column}} THEN 1 ELSE 0 END)::double precision / NULLIF(COUNT(DISTINCT {{task_id_column}}), 0) AS task_success_rate
FROM {{table}}
WHERE {{decision_key_column}} = @decision_key
  AND {{variant_column}} = @variant
  AND {{created_at_column}} >= @start
  AND {{created_at_column}} < @end;
