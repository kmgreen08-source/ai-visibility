/*
  Warnings:

  - You are about to drop the column `snapshotId` on the `Prompt` table. All the data in the column will be lost.
  - Added the required column `promptSetVersionId` to the `Prompt` table without a default value. This is not possible if the table is not empty.
  - Added the required column `snapshotId` to the `ProviderResponse` table without a default value. This is not possible if the table is not empty.
  - Added the required column `promptSetVersionId` to the `Snapshot` table without a default value. This is not possible if the table is not empty.

*/
-- CreateTable
CREATE TABLE "PromptSet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "analysisId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PromptSet_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "Analysis" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PromptSetVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "promptSetId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "competitorsSnapshot" TEXT NOT NULL,
    "changeNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PromptSetVersion_promptSetId_fkey" FOREIGN KEY ("promptSetId") REFERENCES "PromptSet" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CoverageItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "analysisId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "canonicalUrl" TEXT NOT NULL,
    "outletName" TEXT,
    "outletDomain" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "publishedAt" DATETIME NOT NULL,
    "title" TEXT,
    "summary" TEXT,
    "keyClaims" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "addedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CoverageItem_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "Analysis" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CoverageSyndication" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "coverageItemId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    CONSTRAINT "CoverageSyndication_coverageItemId_fkey" FOREIGN KEY ("coverageItemId") REFERENCES "CoverageItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CoverageMatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "coverageItemId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "responseId" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "matchedUrl" TEXT,
    "matchedPassage" TEXT,
    "confidence" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CoverageMatch_coverageItemId_fkey" FOREIGN KEY ("coverageItemId") REFERENCES "CoverageItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CoverageMatch_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "Snapshot" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CoverageMatch_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "ProviderResponse" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CoverageLift" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "coverageItemId" TEXT NOT NULL,
    "theme" TEXT NOT NULL,
    "preMentionRate" REAL,
    "postMentionRate" REAL,
    "preAvgPosition" REAL,
    "postAvgPosition" REAL,
    "preCitationRate" REAL,
    "postCitationRate" REAL,
    "preRunCount" INTEGER NOT NULL,
    "postRunCount" INTEGER NOT NULL,
    "sufficientData" BOOLEAN NOT NULL DEFAULT false,
    "competitorDeltas" TEXT,
    "controlThemeDelta" TEXT,
    "computedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CoverageLift_coverageItemId_fkey" FOREIGN KEY ("coverageItemId") REFERENCES "CoverageItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ConfounderEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "analysisId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "occurredAt" DATETIME NOT NULL,
    "description" TEXT NOT NULL,
    "autoDetected" BOOLEAN NOT NULL DEFAULT true,
    "relatedSnapshotId" TEXT,
    "relatedPromptSetVersionId" TEXT,
    "relatedNewsArticleId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConfounderEvent_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "Analysis" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Analysis" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyName" TEXT NOT NULL,
    "companyUrl" TEXT,
    "categoryHint" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdBy" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "shareToken" TEXT,
    "shareRevoked" BOOLEAN NOT NULL DEFAULT false,
    "scheduleEnabled" BOOLEAN NOT NULL DEFAULT false,
    "scheduleFrequencyDays" INTEGER NOT NULL DEFAULT 7,
    "nextScheduledRunAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Analysis" ("categoryHint", "companyName", "companyUrl", "createdAt", "createdBy", "id", "isDemo", "shareRevoked", "shareToken", "status", "updatedAt") SELECT "categoryHint", "companyName", "companyUrl", "createdAt", "createdBy", "id", "isDemo", "shareRevoked", "shareToken", "status", "updatedAt" FROM "Analysis";
DROP TABLE "Analysis";
ALTER TABLE "new_Analysis" RENAME TO "Analysis";
CREATE UNIQUE INDEX "Analysis_shareToken_key" ON "Analysis"("shareToken");
CREATE INDEX "Analysis_status_idx" ON "Analysis"("status");
CREATE TABLE "new_Prompt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "promptSetVersionId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "theme" TEXT NOT NULL,
    "branded" BOOLEAN NOT NULL DEFAULT false,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Prompt_promptSetVersionId_fkey" FOREIGN KEY ("promptSetVersionId") REFERENCES "PromptSetVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Prompt" ("branded", "createdAt", "id", "orderIndex", "text", "theme") SELECT "branded", "createdAt", "id", "orderIndex", "text", "theme" FROM "Prompt";
DROP TABLE "Prompt";
ALTER TABLE "new_Prompt" RENAME TO "Prompt";
CREATE INDEX "Prompt_promptSetVersionId_idx" ON "Prompt"("promptSetVersionId");
CREATE TABLE "new_ProviderResponse" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "promptId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "engine" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'grounded',
    "model" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "fullText" TEXT,
    "citations" TEXT,
    "errorMessage" TEXT,
    "costUsd" REAL,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProviderResponse_promptId_fkey" FOREIGN KEY ("promptId") REFERENCES "Prompt" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProviderResponse_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "Snapshot" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ProviderResponse" ("citations", "costUsd", "engine", "errorMessage", "fullText", "id", "model", "promptId", "status", "timestamp") SELECT "citations", "costUsd", "engine", "errorMessage", "fullText", "id", "model", "promptId", "status", "timestamp" FROM "ProviderResponse";
DROP TABLE "ProviderResponse";
ALTER TABLE "new_ProviderResponse" RENAME TO "ProviderResponse";
CREATE INDEX "ProviderResponse_promptId_idx" ON "ProviderResponse"("promptId");
CREATE INDEX "ProviderResponse_snapshotId_idx" ON "ProviderResponse"("snapshotId");
CREATE UNIQUE INDEX "ProviderResponse_snapshotId_promptId_engine_mode_key" ON "ProviderResponse"("snapshotId", "promptId", "engine", "mode");
CREATE TABLE "new_Snapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "analysisId" TEXT NOT NULL,
    "promptSetVersionId" TEXT NOT NULL,
    "runNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "engines" TEXT NOT NULL,
    "estimatedCost" REAL,
    "actualCost" REAL,
    "callCount" INTEGER,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "Snapshot_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "Analysis" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Snapshot_promptSetVersionId_fkey" FOREIGN KEY ("promptSetVersionId") REFERENCES "PromptSetVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Snapshot" ("actualCost", "analysisId", "callCount", "completedAt", "createdAt", "engines", "errorMessage", "estimatedCost", "id", "runNumber", "status") SELECT "actualCost", "analysisId", "callCount", "completedAt", "createdAt", "engines", "errorMessage", "estimatedCost", "id", "runNumber", "status" FROM "Snapshot";
DROP TABLE "Snapshot";
ALTER TABLE "new_Snapshot" RENAME TO "Snapshot";
CREATE INDEX "Snapshot_analysisId_idx" ON "Snapshot"("analysisId");
CREATE INDEX "Snapshot_promptSetVersionId_idx" ON "Snapshot"("promptSetVersionId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "PromptSet_analysisId_key" ON "PromptSet"("analysisId");

-- CreateIndex
CREATE UNIQUE INDEX "PromptSetVersion_promptSetId_versionNumber_key" ON "PromptSetVersion"("promptSetId", "versionNumber");

-- CreateIndex
CREATE INDEX "CoverageItem_analysisId_idx" ON "CoverageItem"("analysisId");

-- CreateIndex
CREATE INDEX "CoverageItem_canonicalUrl_idx" ON "CoverageItem"("canonicalUrl");

-- CreateIndex
CREATE INDEX "CoverageSyndication_coverageItemId_idx" ON "CoverageSyndication"("coverageItemId");

-- CreateIndex
CREATE INDEX "CoverageMatch_coverageItemId_idx" ON "CoverageMatch"("coverageItemId");

-- CreateIndex
CREATE INDEX "CoverageMatch_snapshotId_idx" ON "CoverageMatch"("snapshotId");

-- CreateIndex
CREATE INDEX "CoverageLift_coverageItemId_idx" ON "CoverageLift"("coverageItemId");

-- CreateIndex
CREATE INDEX "ConfounderEvent_analysisId_idx" ON "ConfounderEvent"("analysisId");
