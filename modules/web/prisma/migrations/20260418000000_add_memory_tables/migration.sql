-- CreateTable
CREATE TABLE "project_memory" (
    "id" TEXT NOT NULL,
    "featbit_project_key" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "source_agent" TEXT,
    "created_by_user_id" TEXT,
    "editable" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_memory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_memory_featbit_project_key_key_key" ON "project_memory"("featbit_project_key", "key");

-- CreateIndex
CREATE INDEX "project_memory_featbit_project_key_type_idx" ON "project_memory"("featbit_project_key", "type");

-- CreateTable
CREATE TABLE "user_project_memory" (
    "id" TEXT NOT NULL,
    "featbit_project_key" TEXT NOT NULL,
    "featbit_user_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "source_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_project_memory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_project_memory_featbit_project_key_featbit_user_id_key_key" ON "user_project_memory"("featbit_project_key", "featbit_user_id", "key");

-- CreateIndex
CREATE INDEX "user_project_memory_featbit_project_key_featbit_user_id_type_idx" ON "user_project_memory"("featbit_project_key", "featbit_user_id", "type");
