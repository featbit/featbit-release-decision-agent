-- CreateTable
CREATE TABLE "auth_session" (
    "id" TEXT NOT NULL,
    "featbit_token" TEXT NOT NULL,
    "featbit_cookies" JSONB NOT NULL,
    "profile" JSONB NOT NULL,
    "workspace_id" TEXT,
    "organization_id" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "refreshed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_session_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auth_session_expires_at_idx" ON "auth_session"("expires_at");
