-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CompanyProfile_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "Analysis" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_CompanyProfile" ("analysisId", "capabilities", "category", "confirmedCompetitors", "description", "icp", "id", "suggestedCompetitors", "updatedAt") SELECT "analysisId", "capabilities", "category", "confirmedCompetitors", "description", "icp", "id", "suggestedCompetitors", "updatedAt" FROM "CompanyProfile";
DROP TABLE "CompanyProfile";
ALTER TABLE "new_CompanyProfile" RENAME TO "CompanyProfile";
CREATE UNIQUE INDEX "CompanyProfile_analysisId_key" ON "CompanyProfile"("analysisId");
CREATE TABLE "new_PromptSetVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "promptSetId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "competitorsSnapshot" TEXT NOT NULL,
    "changeNote" TEXT,
    "biasCheckReport" TEXT,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PromptSetVersion_promptSetId_fkey" FOREIGN KEY ("promptSetId") REFERENCES "PromptSet" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_PromptSetVersion" ("biasCheckReport", "changeNote", "competitorsSnapshot", "createdAt", "id", "promptSetId", "versionNumber") SELECT "biasCheckReport", "changeNote", "competitorsSnapshot", "createdAt", "id", "promptSetId", "versionNumber" FROM "PromptSetVersion";
DROP TABLE "PromptSetVersion";
ALTER TABLE "new_PromptSetVersion" RENAME TO "PromptSetVersion";
CREATE UNIQUE INDEX "PromptSetVersion_promptSetId_versionNumber_key" ON "PromptSetVersion"("promptSetId", "versionNumber");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
