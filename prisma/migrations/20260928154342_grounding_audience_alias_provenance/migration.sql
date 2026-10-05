-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CompanyProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "analysisId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "icp" TEXT NOT NULL,
    "audienceType" TEXT NOT NULL DEFAULT 'consumer',
    "capabilities" TEXT NOT NULL,
    "aliases" TEXT NOT NULL DEFAULT '[]',
    "aliasesVerified" BOOLEAN NOT NULL DEFAULT false,
    "sources" TEXT,
    "suggestedCompetitors" TEXT NOT NULL,
    "confirmedCompetitors" TEXT NOT NULL,
    "profileSource" TEXT NOT NULL DEFAULT 'groq',
    "competitorsSource" TEXT NOT NULL DEFAULT 'groq',
    "profileGrounded" BOOLEAN NOT NULL DEFAULT false,
    "competitorsGrounded" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CompanyProfile_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "Analysis" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_CompanyProfile" ("aliases", "analysisId", "capabilities", "category", "competitorsSource", "confirmedCompetitors", "description", "icp", "id", "profileSource", "sources", "suggestedCompetitors", "updatedAt") SELECT "aliases", "analysisId", "capabilities", "category", "competitorsSource", "confirmedCompetitors", "description", "icp", "id", "profileSource", "sources", "suggestedCompetitors", "updatedAt" FROM "CompanyProfile";
DROP TABLE "CompanyProfile";
ALTER TABLE "new_CompanyProfile" RENAME TO "CompanyProfile";
CREATE UNIQUE INDEX "CompanyProfile_analysisId_key" ON "CompanyProfile"("analysisId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
