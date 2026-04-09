-- AddColumn: traffic_percent, layer_id, audience_filters on experiment table
ALTER TABLE "experiment" ADD COLUMN IF NOT EXISTS "traffic_percent"   DOUBLE PRECISION DEFAULT 100;
ALTER TABLE "experiment" ADD COLUMN IF NOT EXISTS "layer_id"          TEXT;
ALTER TABLE "experiment" ADD COLUMN IF NOT EXISTS "audience_filters"  TEXT;
