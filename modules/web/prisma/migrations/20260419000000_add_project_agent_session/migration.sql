CREATE TABLE "project_agent_session" (
    "id"              TEXT NOT NULL,
    "project_key"     TEXT NOT NULL,
    "user_id"         TEXT NOT NULL,
    "codex_thread_id" TEXT,
    "messages"        TEXT NOT NULL DEFAULT '[]',
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_agent_session_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "project_agent_session_project_key_user_id_key"
    ON "project_agent_session"("project_key", "user_id");
