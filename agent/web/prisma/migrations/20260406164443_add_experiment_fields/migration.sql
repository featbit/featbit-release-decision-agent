-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Experiment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "hypothesis" TEXT,
    "primaryMetricEvent" TEXT,
    "guardrailEvents" TEXT,
    "controlVariant" TEXT,
    "treatmentVariant" TEXT,
    "minimumSample" INTEGER,
    "observationStart" DATETIME,
    "observationEnd" DATETIME,
    "priorProper" BOOLEAN NOT NULL DEFAULT false,
    "priorMean" REAL,
    "priorStddev" REAL,
    "inputData" TEXT,
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
INSERT INTO "new_Experiment" ("analysisResult", "confirmedOrRefuted", "controlVariant", "createdAt", "decision", "decisionReason", "guardrailEvents", "id", "minimumSample", "nextHypothesis", "observationEnd", "observationStart", "primaryMetricEvent", "projectId", "slug", "status", "treatmentVariant", "updatedAt", "whatChanged", "whatHappened", "whyItHappened") SELECT "analysisResult", "confirmedOrRefuted", "controlVariant", "createdAt", "decision", "decisionReason", "guardrailEvents", "id", "minimumSample", "nextHypothesis", "observationEnd", "observationStart", "primaryMetricEvent", "projectId", "slug", "status", "treatmentVariant", "updatedAt", "whatChanged", "whatHappened", "whyItHappened" FROM "Experiment";
DROP TABLE "Experiment";
ALTER TABLE "new_Experiment" RENAME TO "Experiment";
CREATE UNIQUE INDEX "Experiment_projectId_slug_key" ON "Experiment"("projectId", "slug");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
