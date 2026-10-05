/*
  Warnings:

  - You are about to drop the column `biasCheckReport` on the `PromptSetVersion` table. All the data in the column will be lost.

*/
-- CreateTable
CREATE TABLE "BiasCheckRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "promptId" TEXT NOT NULL,
    "promptSetVersionId" TEXT NOT NULL,
    "original" TEXT NOT NULL,
    "rewritten" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BiasCheckRecord_promptId_fkey" FOREIGN KEY ("promptId") REFERENCES "Prompt" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ExtractedAnalysis" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "responseId" TEXT NOT NULL,
    "brandMentions" TEXT NOT NULL,
    "otherBrandsMentioned" TEXT NOT NULL,
    "judgeModel" TEXT,
    "wasRetried" BOOLEAN NOT NULL DEFAULT false,
    "flaggedForReview" BOOLEAN NOT NULL DEFAULT false,
    "correctedBrandMentions" TEXT,
    "correctedBy" TEXT,
    "correctedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExtractedAnalysis_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "ProviderResponse" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ExtractedAnalysis" ("brandMentions", "createdAt", "id", "otherBrandsMentioned", "responseId") SELECT "brandMentions", "createdAt", "id", "otherBrandsMentioned", "responseId" FROM "ExtractedAnalysis";
DROP TABLE "ExtractedAnalysis";
ALTER TABLE "new_ExtractedAnalysis" RENAME TO "ExtractedAnalysis";
CREATE UNIQUE INDEX "ExtractedAnalysis_responseId_key" ON "ExtractedAnalysis"("responseId");
CREATE TABLE "new_PromptSetVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "promptSetId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "competitorsSnapshot" TEXT NOT NULL,
    "changeNote" TEXT,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PromptSetVersion_promptSetId_fkey" FOREIGN KEY ("promptSetId") REFERENCES "PromptSet" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_PromptSetVersion" ("changeNote", "competitorsSnapshot", "createdAt", "id", "locked", "promptSetId", "versionNumber") SELECT "changeNote", "competitorsSnapshot", "createdAt", "id", "locked", "promptSetId", "versionNumber" FROM "PromptSetVersion";
DROP TABLE "PromptSetVersion";
ALTER TABLE "new_PromptSetVersion" RENAME TO "PromptSetVersion";
CREATE UNIQUE INDEX "PromptSetVersion_promptSetId_versionNumber_key" ON "PromptSetVersion"("promptSetId", "versionNumber");
CREATE TABLE "new_ProviderResponse" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "promptId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "engine" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'grounded',
    "sampleIndex" INTEGER NOT NULL DEFAULT 0,
    "model" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "fullText" TEXT,
    "citations" TEXT,
    "errorMessage" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "latencyMs" INTEGER,
    "costUsd" REAL,
    "cachedFrom" TEXT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProviderResponse_promptId_fkey" FOREIGN KEY ("promptId") REFERENCES "Prompt" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProviderResponse_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "Snapshot" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ProviderResponse" ("citations", "costUsd", "engine", "errorMessage", "fullText", "id", "mode", "model", "promptId", "snapshotId", "status", "timestamp") SELECT "citations", "costUsd", "engine", "errorMessage", "fullText", "id", "mode", "model", "promptId", "snapshotId", "status", "timestamp" FROM "ProviderResponse";
DROP TABLE "ProviderResponse";
ALTER TABLE "new_ProviderResponse" RENAME TO "ProviderResponse";
CREATE INDEX "ProviderResponse_promptId_idx" ON "ProviderResponse"("promptId");
CREATE INDEX "ProviderResponse_snapshotId_idx" ON "ProviderResponse"("snapshotId");
CREATE UNIQUE INDEX "ProviderResponse_snapshotId_promptId_engine_mode_sampleIndex_key" ON "ProviderResponse"("snapshotId", "promptId", "engine", "mode", "sampleIndex");
CREATE TABLE "new_Snapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "analysisId" TEXT NOT NULL,
    "promptSetVersionId" TEXT NOT NULL,
    "runNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "engines" TEXT NOT NULL,
    "samplesPerPrompt" INTEGER NOT NULL DEFAULT 1,
    "dualMode" BOOLEAN NOT NULL DEFAULT false,
    "estimatedCost" REAL,
    "actualCost" REAL,
    "callCount" INTEGER,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "Snapshot_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "Analysis" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Snapshot_promptSetVersionId_fkey" FOREIGN KEY ("promptSetVersionId") REFERENCES "PromptSetVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Snapshot" ("actualCost", "analysisId", "callCount", "completedAt", "createdAt", "engines", "errorMessage", "estimatedCost", "id", "promptSetVersionId", "runNumber", "status") SELECT "actualCost", "analysisId", "callCount", "completedAt", "createdAt", "engines", "errorMessage", "estimatedCost", "id", "promptSetVersionId", "runNumber", "status" FROM "Snapshot";
DROP TABLE "Snapshot";
ALTER TABLE "new_Snapshot" RENAME TO "Snapshot";
CREATE INDEX "Snapshot_analysisId_idx" ON "Snapshot"("analysisId");
CREATE INDEX "Snapshot_promptSetVersionId_idx" ON "Snapshot"("promptSetVersionId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "BiasCheckRecord_promptId_idx" ON "BiasCheckRecord"("promptId");

-- CreateIndex
CREATE INDEX "BiasCheckRecord_promptSetVersionId_idx" ON "BiasCheckRecord"("promptSetVersionId");
