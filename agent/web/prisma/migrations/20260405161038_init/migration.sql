-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "stage" TEXT NOT NULL DEFAULT 'intent',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "flagKey" TEXT,
    "envSecret" TEXT,
    "accessToken" TEXT,
    "flagServerUrl" TEXT,
    "sandboxId" TEXT,
    "sandboxStatus" TEXT DEFAULT 'idle',
    "goal" TEXT,
    "intent" TEXT,
    "hypothesis" TEXT,
    "change" TEXT,
    "variants" TEXT,
    "primaryMetric" TEXT,
    "guardrails" TEXT,
    "constraints" TEXT,
    "openQuestions" TEXT,
    "lastAction" TEXT,
    "lastLearning" TEXT
);

-- CreateTable
CREATE TABLE "Experiment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "primaryMetricEvent" TEXT,
    "guardrailEvents" TEXT,
    "controlVariant" TEXT,
    "treatmentVariant" TEXT,
    "minimumSample" INTEGER,
    "observationStart" DATETIME,
    "observationEnd" DATETIME,
    "analysisResult" TEXT,
    "decision" TEXT,
    "decisionReason" TEXT,
    "whatChanged" TEXT,
    "whatHappened" TEXT,
    "confirmedOrRefuted" TEXT,
    "whyItHappened" TEXT,
    "nextHypothesis" TEXT,
    CONSTRAINT "Experiment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Activity_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Experiment_projectId_slug_key" ON "Experiment"("projectId", "slug");
