SELECT
  AVG({{cost_column}}) AS avg_cost
FROM {{table}}
WHERE {{decision_key_column}} = @decision_key
  AND {{variant_column}} = @variant
  AND {{created_at_column}} >= @start
  AND {{created_at_column}} < @end;
