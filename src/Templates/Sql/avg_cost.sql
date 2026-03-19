SELECT
  avg(cost) AS avg_cost
FROM decision_events
WHERE decision_key = {decision_key:String}
  AND variant = {variant:String}
  AND created_at >= {start:DateTime}
  AND created_at < {end:DateTime};
