-- Migration: add Customer Managed Data Endpoints support.
--
-- Spec:           docs/customer-managed-data-endpoints-v1.md
-- Implementation: docs/customer-managed-endpoints-implementation.md  (PR 1)
--
-- Impact analysis on Postgres 11+ (Azure PG Flexible Server is 13/14/15/16):
--   1. CREATE TABLE on a new empty table — zero impact on existing rows.
--   2. ADD COLUMN ... DEFAULT 'featbit-managed' is metadata-only since PG 11
--      (atthasmissing / attmissingval). No table rewrite. The catalog flip
--      takes an AccessExclusiveLock on experiment_run for milliseconds.
--   3. ADD COLUMN customer_endpoint_config TEXT (nullable, no default) —
--      also metadata-only.
--
-- The lock_timeout below protects against blocking behind a long-running
-- transaction on experiment_run: if the lock cannot be acquired within 5s,
-- the migration aborts cleanly (whole transaction rolls back) and can be
-- retried later. Bump if your maintenance window can tolerate longer waits.
SET lock_timeout = '5s';

-- AlterTable
ALTER TABLE "experiment_run" ADD COLUMN "data_source_mode" TEXT DEFAULT 'featbit-managed';
ALTER TABLE "experiment_run" ADD COLUMN "customer_endpoint_config" TEXT;

-- CreateTable
CREATE TABLE "customer_endpoint_provider" (
    "id" TEXT NOT NULL,
    "project_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "base_url" TEXT NOT NULL,
    "signing_secret" TEXT NOT NULL,
    "secondary_secret" TEXT,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "timeout_ms" INTEGER NOT NULL DEFAULT 15000,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_endpoint_provider_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_endpoint_provider_project_key_name_key" ON "customer_endpoint_provider"("project_key", "name");

-- CreateIndex
CREATE INDEX "customer_endpoint_provider_project_key_idx" ON "customer_endpoint_provider"("project_key");
