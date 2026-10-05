-- AlterTable
ALTER TABLE "NewsArticle" ADD COLUMN "classificationSource" TEXT;

-- CreateTable
CREATE TABLE "ReasoningCache" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "task" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "output" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_BiasCheckRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "promptId" TEXT NOT NULL,
    "promptSetVersionId" TEXT NOT NULL,
    "original" TEXT NOT NULL,
    "rewritten" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "rewriteSource" TEXT NOT NULL DEFAULT 'heuristic',
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BiasCheckRecord_promptId_fkey" FOREIGN KEY ("promptId") REFERENCES "Prompt" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_BiasCheckRecord" ("createdAt", "explanation", "id", "original", "promptId", "promptSetVersionId", "reason", "resolvedAt", "rewritten", "status") SELECT "createdAt", "explanation", "id", "original", "promptId", "promptSetVersionId", "reason", "resolvedAt", "rewritten", "status" FROM "BiasCheckRecord";
DROP TABLE "BiasCheckRecord";
ALTER TABLE "new_BiasCheckRecord" RENAME TO "BiasCheckRecord";
CREATE INDEX "BiasCheckRecord_promptId_idx" ON "BiasCheckRecord"("promptId");
CREATE INDEX "BiasCheckRecord_promptSetVersionId_idx" ON "BiasCheckRecord"("promptSetVersionId");
CREATE TABLE "new_CompanyProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "analysisId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "icp" TEXT NOT NULL,
    "capabilities" TEXT NOT NULL,
    "aliases" TEXT NOT NULL DEFAULT '[]',
    "sources" TEXT,
    "suggestedCompetitors" TEXT NOT NULL,
    "confirmedCompetitors" TEXT NOT NULL,
    "profileSource" TEXT NOT NULL DEFAULT 'groq',
    "competitorsSource" TEXT NOT NULL DEFAULT 'groq',
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CompanyProfile_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "Analysis" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_CompanyProfile" ("aliases", "analysisId", "capabilities", "category", "confirmedCompetitors", "description", "icp", "id", "sources", "suggestedCompetitors", "updatedAt") SELECT "aliases", "analysisId", "capabilities", "category", "confirmedCompetitors", "description", "icp", "id", "sources", "suggestedCompetitors", "updatedAt" FROM "CompanyProfile";
DROP TABLE "CompanyProfile";
ALTER TABLE "new_CompanyProfile" RENAME TO "CompanyProfile";
CREATE UNIQUE INDEX "CompanyProfile_analysisId_key" ON "CompanyProfile"("analysisId");
CREATE TABLE "new_ExtractedAnalysis" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "responseId" TEXT NOT NULL,
    "brandMentions" TEXT NOT NULL,
    "otherBrandsMentioned" TEXT NOT NULL,
    "judgeModel" TEXT,
    "judgeSource" TEXT NOT NULL DEFAULT 'heuristic',
    "wasRetried" BOOLEAN NOT NULL DEFAULT false,
    "flaggedForReview" BOOLEAN NOT NULL DEFAULT false,
    "correctedBrandMentions" TEXT,
    "correctedBy" TEXT,
    "correctedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExtractedAnalysis_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "ProviderResponse" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ExtractedAnalysis" ("brandMentions", "correctedAt", "correctedBrandMentions", "correctedBy", "createdAt", "flaggedForReview", "id", "judgeModel", "otherBrandsMentioned", "responseId", "wasRetried") SELECT "brandMentions", "correctedAt", "correctedBrandMentions", "correctedBy", "createdAt", "flaggedForReview", "id", "judgeModel", "otherBrandsMentioned", "responseId", "wasRetried" FROM "ExtractedAnalysis";
DROP TABLE "ExtractedAnalysis";
ALTER TABLE "new_ExtractedAnalysis" RENAME TO "ExtractedAnalysis";
CREATE UNIQUE INDEX "ExtractedAnalysis_responseId_key" ON "ExtractedAnalysis"("responseId");
CREATE TABLE "new_Prompt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "promptSetVersionId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "theme" TEXT NOT NULL,
    "branded" BOOLEAN NOT NULL DEFAULT false,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'groq',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Prompt_promptSetVersionId_fkey" FOREIGN KEY ("promptSetVersionId") REFERENCES "PromptSetVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Prompt" ("branded", "createdAt", "id", "orderIndex", "promptSetVersionId", "text", "theme") SELECT "branded", "createdAt", "id", "orderIndex", "promptSetVersionId", "text", "theme" FROM "Prompt";
DROP TABLE "Prompt";
ALTER TABLE "new_Prompt" RENAME TO "Prompt";
CREATE INDEX "Prompt_promptSetVersionId_idx" ON "Prompt"("promptSetVersionId");
CREATE TABLE "new_Settings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "agencyName" TEXT NOT NULL DEFAULT 'Your Agency',
    "agencyLogoUrl" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#1f6feb',
    "defaultEngines" TEXT NOT NULL DEFAULT '["openai","anthropic","gemini","perplexity"]',
    "defaultPromptCount" INTEGER NOT NULL DEFAULT 24,
    "newsLookbackDays" INTEGER NOT NULL DEFAULT 90,
    "taskModels" TEXT NOT NULL DEFAULT '{}',
    "groqConcurrency" INTEGER NOT NULL DEFAULT 2
);
INSERT INTO "new_Settings" ("agencyLogoUrl", "agencyName", "defaultEngines", "defaultPromptCount", "id", "newsLookbackDays", "primaryColor") SELECT "agencyLogoUrl", "agencyName", "defaultEngines", "defaultPromptCount", "id", "newsLookbackDays", "primaryColor" FROM "Settings";
DROP TABLE "Settings";
ALTER TABLE "new_Settings" RENAME TO "Settings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "ReasoningCache_task_provider_model_inputHash_key" ON "ReasoningCache"("task", "provider", "model", "inputHash");
