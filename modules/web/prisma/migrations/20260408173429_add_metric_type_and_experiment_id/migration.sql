-- AlterTable
ALTER TABLE "Experiment" ADD COLUMN     "experimentId" TEXT,
ADD COLUMN     "primaryMetricAgg" TEXT DEFAULT 'once',
ADD COLUMN     "primaryMetricType" TEXT DEFAULT 'binary';
