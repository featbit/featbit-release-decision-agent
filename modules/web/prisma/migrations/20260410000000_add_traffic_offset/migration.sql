-- AddColumn: traffic_offset on experiment table (bucket start for mutual-exclusion)
ALTER TABLE "experiment" ADD COLUMN IF NOT EXISTS "traffic_offset" INTEGER DEFAULT 0;
