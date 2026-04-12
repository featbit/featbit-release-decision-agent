-- Merge "intent" stage into "hypothesis"
-- Update existing experiments that are still on the old "intent" stage
UPDATE "experiment" SET "stage" = 'hypothesis' WHERE "stage" = 'intent';

-- Change the default value for new experiments
ALTER TABLE "experiment" ALTER COLUMN "stage" SET DEFAULT 'hypothesis';
