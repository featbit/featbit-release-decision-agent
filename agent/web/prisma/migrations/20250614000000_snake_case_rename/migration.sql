-- Rename tables: PascalCase → snake_case

-- Drop foreign keys first (they reference old table/column names)
ALTER TABLE "Experiment" DROP CONSTRAINT "Experiment_projectId_fkey";
ALTER TABLE "Activity" DROP CONSTRAINT "Activity_projectId_fkey";
ALTER TABLE "Message" DROP CONSTRAINT "Message_projectId_fkey";

-- Drop unique index
DROP INDEX "Experiment_projectId_slug_key";

-- Rename columns: Project
ALTER TABLE "Project" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "Project" RENAME COLUMN "updatedAt" TO "updated_at";
ALTER TABLE "Project" RENAME COLUMN "flagKey" TO "flag_key";
ALTER TABLE "Project" RENAME COLUMN "envSecret" TO "env_secret";
ALTER TABLE "Project" RENAME COLUMN "accessToken" TO "access_token";
ALTER TABLE "Project" RENAME COLUMN "flagServerUrl" TO "flag_server_url";
ALTER TABLE "Project" RENAME COLUMN "sandboxId" TO "sandbox_id";
ALTER TABLE "Project" RENAME COLUMN "sandboxStatus" TO "sandbox_status";
ALTER TABLE "Project" RENAME COLUMN "primaryMetric" TO "primary_metric";
ALTER TABLE "Project" RENAME COLUMN "openQuestions" TO "open_questions";
ALTER TABLE "Project" RENAME COLUMN "lastAction" TO "last_action";
ALTER TABLE "Project" RENAME COLUMN "lastLearning" TO "last_learning";

-- Rename columns: Experiment
ALTER TABLE "Experiment" RENAME COLUMN "projectId" TO "project_id";
ALTER TABLE "Experiment" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "Experiment" RENAME COLUMN "updatedAt" TO "updated_at";
ALTER TABLE "Experiment" RENAME COLUMN "experimentId" TO "experiment_id";
ALTER TABLE "Experiment" RENAME COLUMN "methodReason" TO "method_reason";
ALTER TABLE "Experiment" RENAME COLUMN "primaryMetricEvent" TO "primary_metric_event";
ALTER TABLE "Experiment" RENAME COLUMN "primaryMetricType" TO "primary_metric_type";
ALTER TABLE "Experiment" RENAME COLUMN "primaryMetricAgg" TO "primary_metric_agg";
ALTER TABLE "Experiment" RENAME COLUMN "metricDescription" TO "metric_description";
ALTER TABLE "Experiment" RENAME COLUMN "guardrailEvents" TO "guardrail_events";
ALTER TABLE "Experiment" RENAME COLUMN "guardrailDescriptions" TO "guardrail_descriptions";
ALTER TABLE "Experiment" RENAME COLUMN "controlVariant" TO "control_variant";
ALTER TABLE "Experiment" RENAME COLUMN "treatmentVariant" TO "treatment_variant";
ALTER TABLE "Experiment" RENAME COLUMN "trafficAllocation" TO "traffic_allocation";
ALTER TABLE "Experiment" RENAME COLUMN "minimumSample" TO "minimum_sample";
ALTER TABLE "Experiment" RENAME COLUMN "observationStart" TO "observation_start";
ALTER TABLE "Experiment" RENAME COLUMN "observationEnd" TO "observation_end";
ALTER TABLE "Experiment" RENAME COLUMN "priorProper" TO "prior_proper";
ALTER TABLE "Experiment" RENAME COLUMN "priorMean" TO "prior_mean";
ALTER TABLE "Experiment" RENAME COLUMN "priorStddev" TO "prior_stddev";
ALTER TABLE "Experiment" RENAME COLUMN "inputData" TO "input_data";
ALTER TABLE "Experiment" RENAME COLUMN "analysisResult" TO "analysis_result";
ALTER TABLE "Experiment" RENAME COLUMN "decisionSummary" TO "decision_summary";
ALTER TABLE "Experiment" RENAME COLUMN "decisionReason" TO "decision_reason";
ALTER TABLE "Experiment" RENAME COLUMN "whatChanged" TO "what_changed";
ALTER TABLE "Experiment" RENAME COLUMN "whatHappened" TO "what_happened";
ALTER TABLE "Experiment" RENAME COLUMN "confirmedOrRefuted" TO "confirmed_or_refuted";
ALTER TABLE "Experiment" RENAME COLUMN "whyItHappened" TO "why_it_happened";
ALTER TABLE "Experiment" RENAME COLUMN "nextHypothesis" TO "next_hypothesis";

-- Rename columns: Activity
ALTER TABLE "Activity" RENAME COLUMN "projectId" TO "project_id";
ALTER TABLE "Activity" RENAME COLUMN "createdAt" TO "created_at";

-- Rename columns: Message
ALTER TABLE "Message" RENAME COLUMN "projectId" TO "project_id";
ALTER TABLE "Message" RENAME COLUMN "createdAt" TO "created_at";

-- Rename tables
ALTER TABLE "Project" RENAME TO "project";
ALTER TABLE "Experiment" RENAME TO "experiment";
ALTER TABLE "Activity" RENAME TO "activity";
ALTER TABLE "Message" RENAME TO "message";

-- Rename primary key constraints
ALTER TABLE "project" RENAME CONSTRAINT "Project_pkey" TO "project_pkey";
ALTER TABLE "experiment" RENAME CONSTRAINT "Experiment_pkey" TO "experiment_pkey";
ALTER TABLE "activity" RENAME CONSTRAINT "Activity_pkey" TO "activity_pkey";
ALTER TABLE "message" RENAME CONSTRAINT "Message_pkey" TO "message_pkey";

-- Recreate unique index with new names
CREATE UNIQUE INDEX "experiment_project_id_slug_key" ON "experiment"("project_id", "slug");

-- Recreate foreign keys with new names
ALTER TABLE "experiment" ADD CONSTRAINT "experiment_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "activity" ADD CONSTRAINT "activity_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "message" ADD CONSTRAINT "message_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
