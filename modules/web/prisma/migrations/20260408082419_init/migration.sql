-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "stage" TEXT NOT NULL DEFAULT 'intent',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
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
    "lastLearning" TEXT,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Experiment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "hypothesis" TEXT,
    "method" TEXT,
    "methodReason" TEXT,
    "primaryMetricEvent" TEXT,
    "metricDescription" TEXT,
    "guardrailEvents" TEXT,
    "guardrailDescriptions" TEXT,
    "controlVariant" TEXT,
    "treatmentVariant" TEXT,
    "trafficAllocation" TEXT,
    "minimumSample" INTEGER,
    "observationStart" TIMESTAMP(3),
    "observationEnd" TIMESTAMP(3),
    "priorProper" BOOLEAN NOT NULL DEFAULT false,
    "priorMean" DOUBLE PRECISION,
    "priorStddev" DOUBLE PRECISION,
    "inputData" TEXT,
    "analysisResult" TEXT,
    "decision" TEXT,
    "decisionSummary" TEXT,
    "decisionReason" TEXT,
    "whatChanged" TEXT,
    "whatHappened" TEXT,
    "confirmedOrRefuted" TEXT,
    "whyItHappened" TEXT,
    "nextHypothesis" TEXT,

    CONSTRAINT "Experiment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Experiment_projectId_slug_key" ON "Experiment"("projectId", "slug");

-- AddForeignKey
ALTER TABLE "Experiment" ADD CONSTRAINT "Experiment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
