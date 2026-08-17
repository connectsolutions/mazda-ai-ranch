-- AlterTable
ALTER TABLE "Source" ADD COLUMN     "indexError" TEXT,
ADD COLUMN     "indexedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Source_knowledgeId_createdAt_idx" ON "Source"("knowledgeId", "createdAt");
