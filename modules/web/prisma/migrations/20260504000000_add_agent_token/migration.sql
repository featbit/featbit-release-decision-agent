-- Migration: add per-project agent access tokens.
--
-- Used by the local Claude Code agent + any headless caller of
-- /api/experiments/* to authenticate without an fb_session cookie. Tokens
-- are issued from the /data/env-settings UI; the plaintext is returned
-- ONCE and only the SHA-256 hash is stored here.
--
-- Impact: CREATE TABLE on an empty new table — zero impact on existing rows.
SET lock_timeout = '5s';

-- CreateTable
CREATE TABLE "agent_token" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "project_key" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "created_by_user_id" TEXT,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "agent_token_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_token_token_hash_key" ON "agent_token"("token_hash");

-- CreateIndex
CREATE INDEX "agent_token_project_key_idx" ON "agent_token"("project_key");
