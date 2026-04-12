/*
  Warnings:

  - You are about to drop the column `project_id` on the `activity` table. All the data in the column will be lost.
  - You are about to drop the column `analysis_result` on the `experiment` table. All the data in the column will be lost.
  - You are about to drop the column `audience_filters` on the `experiment` table. All the data in the column will be lost.
  - You are about to drop the column `confirmed_or_refuted` on the `experiment` table. All the data in the column will be lost.
  - You are about to drop the column `control_variant` on the `experiment` table. All the data in the column will be lost.
  - You are about to drop the column `decision` on the `experiment` table. All the data in the column will be lost.
  - You are about to drop the column `decision_reason` on the `experiment` table. All the data in the column will be lost.
  - You are about to drop the column `decision_summary` on the `experiment` table. All the data in the column will be lost.
  - You are about to drop the column `experiment_id` on the `experiment` table. All the data in the column will be lost.
  - You are about to drop the column `guardrail_descriptions` on the `experiment` table. All the data in the column will be lost.
  - You are about to drop the column `guardrail_events` on the `experiment` table. All the data in the column will be lost.
  - You are about to drop the column `input_data` on the `experiment` table. All the data in the column will be lost.
  - You are about to drop the column `layer_id` on the `experiment` table. All the data in the column will be lost.
  - You are about to drop the column `method` on the `experiment` table. All the data in the column will be lost.
  - You are about to drop the column `method_reason` on the `experiment` table. All the data in the column will be lost.
  - You are about to drop the column `metric_description` on the `experiment` table. All the data in the column will be lost.
  - You are about to drop the column `minimum_sample` on the `experiment` table. All the data in the column will be lost.
  - You are about to drop the column `next_hypothesis` on the `experiment` table. All the data in the column will be lost.
  - You are about to drop the column `observation_end` on the `experiment` table. All the data in the column will be lost.
  - You are about to drop the column `observation_start` on the `experiment` table. All the data in the column will be lost.
  - You are about to drop the column `primary_metric_agg` on the `experiment` table. All the data in the column will be lost.
  - You are about to drop the column `primary_metric_event` on the `experiment` table. All the data in the column will be lost.
  - You are about to drop the column `primary_metric_type` on the `experiment` table. All the data in the column will be lost.
  - You are about to drop the column `prior_mean` on the `experiment` table. All the data in the column will be lost.
  - You are about to drop the column `prior_proper` on the `experiment` table. All the data in the column will be lost.
  - You are about to drop the column `prior_stddev` on the `experiment` table. All the data in the column will be lost.
  - You are about to drop the column `project_id` on the `experiment` table. All the data in the column will be lost.
  - You are about to drop the column `slug` on the `experiment` table. All the data in the column will be lost.
  - You are about to drop the column `status` on the `experiment` table. All the data in the column will be lost.
  - You are about to drop the column `traffic_allocation` on the `experiment` table. All the data in the column will be lost.
  - You are about to drop the column `traffic_offset` on the `experiment` table. All the data in the column will be lost.
  - You are about to drop the column `traffic_percent` on the `experiment` table. All the data in the column will be lost.
  - You are about to drop the column `treatment_variant` on the `experiment` table. All the data in the column will be lost.
  - You are about to drop the column `what_changed` on the `experiment` table. All the data in the column will be lost.
  - You are about to drop the column `what_happened` on the `experiment` table. All the data in the column will be lost.
  - You are about to drop the column `why_it_happened` on the `experiment` table. All the data in the column will be lost.
  - You are about to drop the column `project_id` on the `message` table. All the data in the column will be lost.
  - You are about to drop the `project` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `experiment_id` to the `activity` table without a default value. This is not possible if the table is not empty.
  - Added the required column `name` to the `experiment` table without a default value. This is not possible if the table is not empty.
  - Added the required column `experiment_id` to the `message` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "activity" DROP CONSTRAINT "activity_project_id_fkey";

-- DropForeignKey
ALTER TABLE "experiment" DROP CONSTRAINT "experiment_project_id_fkey";

-- DropForeignKey
ALTER TABLE "message" DROP CONSTRAINT "message_project_id_fkey";

-- DropIndex
DROP INDEX "experiment_project_id_slug_key";

-- AlterTable
ALTER TABLE "activity" DROP COLUMN "project_id",
ADD COLUMN     "experiment_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "experiment" DROP COLUMN "analysis_result",
DROP COLUMN "audience_filters",
DROP COLUMN "confirmed_or_refuted",
DROP COLUMN "control_variant",
DROP COLUMN "decision",
DROP COLUMN "decision_reason",
DROP COLUMN "decision_summary",
DROP COLUMN "experiment_id",
DROP COLUMN "guardrail_descriptions",
DROP COLUMN "guardrail_events",
DROP COLUMN "input_data",
DROP COLUMN "layer_id",
DROP COLUMN "method",
DROP COLUMN "method_reason",
DROP COLUMN "metric_description",
DROP COLUMN "minimum_sample",
DROP COLUMN "next_hypothesis",
DROP COLUMN "observation_end",
DROP COLUMN "observation_start",
DROP COLUMN "primary_metric_agg",
DROP COLUMN "primary_metric_event",
DROP COLUMN "primary_metric_type",
DROP COLUMN "prior_mean",
DROP COLUMN "prior_proper",
DROP COLUMN "prior_stddev",
DROP COLUMN "project_id",
DROP COLUMN "slug",
DROP COLUMN "status",
DROP COLUMN "traffic_allocation",
DROP COLUMN "traffic_offset",
DROP COLUMN "traffic_percent",
DROP COLUMN "treatment_variant",
DROP COLUMN "what_changed",
DROP COLUMN "what_happened",
DROP COLUMN "why_it_happened",
ADD COLUMN     "access_token" TEXT,
ADD COLUMN     "change" TEXT,
ADD COLUMN     "constraints" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "env_secret" TEXT,
ADD COLUMN     "flag_key" TEXT,
ADD COLUMN     "flag_server_url" TEXT,
ADD COLUMN     "goal" TEXT,
ADD COLUMN     "guardrails" TEXT,
ADD COLUMN     "intent" TEXT,
ADD COLUMN     "last_action" TEXT,
ADD COLUMN     "last_learning" TEXT,
ADD COLUMN     "name" TEXT NOT NULL,
ADD COLUMN     "open_questions" TEXT,
ADD COLUMN     "primary_metric" TEXT,
ADD COLUMN     "sandbox_id" TEXT,
ADD COLUMN     "sandbox_status" TEXT DEFAULT 'idle',
ADD COLUMN     "stage" TEXT NOT NULL DEFAULT 'intent',
ADD COLUMN     "variants" TEXT;

-- AlterTable
ALTER TABLE "message" DROP COLUMN "project_id",
ADD COLUMN     "experiment_id" TEXT NOT NULL;

-- DropTable
DROP TABLE "project";

-- CreateTable
CREATE TABLE "experiment_run" (
    "id" TEXT NOT NULL,
    "experiment_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "hypothesis" TEXT,
    "method" TEXT,
    "method_reason" TEXT,
    "primary_metric_event" TEXT,
    "metric_description" TEXT,
    "guardrail_events" TEXT,
    "guardrail_descriptions" TEXT,
    "control_variant" TEXT,
    "treatment_variant" TEXT,
    "traffic_allocation" TEXT,
    "minimum_sample" INTEGER,
    "observation_start" TIMESTAMP(3),
    "observation_end" TIMESTAMP(3),
    "prior_proper" BOOLEAN NOT NULL DEFAULT false,
    "prior_mean" DOUBLE PRECISION,
    "prior_stddev" DOUBLE PRECISION,
    "input_data" TEXT,
    "analysis_result" TEXT,
    "decision" TEXT,
    "decision_summary" TEXT,
    "decision_reason" TEXT,
    "what_changed" TEXT,
    "what_happened" TEXT,
    "confirmed_or_refuted" TEXT,
    "why_it_happened" TEXT,
    "next_hypothesis" TEXT,
    "run_id" TEXT,
    "primary_metric_agg" TEXT DEFAULT 'once',
    "primary_metric_type" TEXT DEFAULT 'binary',
    "traffic_percent" DOUBLE PRECISION DEFAULT 100,
    "layer_id" TEXT,
    "audience_filters" TEXT,
    "traffic_offset" INTEGER DEFAULT 0,

    CONSTRAINT "experiment_run_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "experiment_run_experiment_id_slug_key" ON "experiment_run"("experiment_id", "slug");

-- NOTE: flag_evaluations and metric_events are partitioned tables managed by
-- docker/init-events.sql (run after migrations). Do NOT create them here —
-- Prisma does not support PARTITION BY.

-- AddForeignKey
ALTER TABLE "experiment_run" ADD CONSTRAINT "experiment_run_experiment_id_fkey" FOREIGN KEY ("experiment_id") REFERENCES "experiment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity" ADD CONSTRAINT "activity_experiment_id_fkey" FOREIGN KEY ("experiment_id") REFERENCES "experiment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message" ADD CONSTRAINT "message_experiment_id_fkey" FOREIGN KEY ("experiment_id") REFERENCES "experiment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
