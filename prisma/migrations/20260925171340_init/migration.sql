-- CreateTable
CREATE TABLE "Analysis" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyName" TEXT NOT NULL,
    "companyUrl" TEXT,
    "categoryHint" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdBy" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "shareToken" TEXT,
    "shareRevoked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CompanyProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "analysisId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "icp" TEXT NOT NULL,
    "capabilities" TEXT NOT NULL,
    "suggestedCompetitors" TEXT NOT NULL,
    "confirmedCompetitors" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CompanyProfile_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "Analysis" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Snapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "analysisId" TEXT NOT NULL,
    "runNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "engines" TEXT NOT NULL,
    "estimatedCost" REAL,
    "actualCost" REAL,
    "callCount" INTEGER,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "Snapshot_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "Analysis" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Prompt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "snapshotId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "theme" TEXT NOT NULL,
    "branded" BOOLEAN NOT NULL DEFAULT false,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Prompt_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "Snapshot" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProviderResponse" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "promptId" TEXT NOT NULL,
    "engine" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "fullText" TEXT,
    "citations" TEXT,
    "errorMessage" TEXT,
    "costUsd" REAL,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProviderResponse_promptId_fkey" FOREIGN KEY ("promptId") REFERENCES "Prompt" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExtractedAnalysis" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "responseId" TEXT NOT NULL,
    "brandMentions" TEXT NOT NULL,
    "otherBrandsMentioned" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExtractedAnalysis_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "ProviderResponse" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NewsArticle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "snapshotId" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "publishedAt" DATETIME NOT NULL,
    "sentiment" TEXT,
    "topic" TEXT,
    "dedupeHash" TEXT NOT NULL,
    CONSTRAINT "NewsArticle_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "Snapshot" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Finding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "snapshotId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "evidenceRefs" TEXT,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "Finding_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "Snapshot" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Settings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "agencyName" TEXT NOT NULL DEFAULT 'Your Agency',
    "agencyLogoUrl" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#1f6feb',
    "defaultEngines" TEXT NOT NULL DEFAULT '["groq"]',
    "defaultPromptCount" INTEGER NOT NULL DEFAULT 24,
    "newsLookbackDays" INTEGER NOT NULL DEFAULT 90
);

-- CreateIndex
CREATE UNIQUE INDEX "Analysis_shareToken_key" ON "Analysis"("shareToken");

-- CreateIndex
CREATE INDEX "Analysis_status_idx" ON "Analysis"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyProfile_analysisId_key" ON "CompanyProfile"("analysisId");

-- CreateIndex
CREATE INDEX "Snapshot_analysisId_idx" ON "Snapshot"("analysisId");

-- CreateIndex
CREATE INDEX "Prompt_snapshotId_idx" ON "Prompt"("snapshotId");

-- CreateIndex
CREATE INDEX "ProviderResponse_promptId_idx" ON "ProviderResponse"("promptId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderResponse_promptId_engine_key" ON "ProviderResponse"("promptId", "engine");

-- CreateIndex
CREATE UNIQUE INDEX "ExtractedAnalysis_responseId_key" ON "ExtractedAnalysis"("responseId");

-- CreateIndex
CREATE INDEX "NewsArticle_snapshotId_idx" ON "NewsArticle"("snapshotId");

-- CreateIndex
CREATE INDEX "NewsArticle_dedupeHash_idx" ON "NewsArticle"("dedupeHash");

-- CreateIndex
CREATE INDEX "Finding_snapshotId_idx" ON "Finding"("snapshotId");
