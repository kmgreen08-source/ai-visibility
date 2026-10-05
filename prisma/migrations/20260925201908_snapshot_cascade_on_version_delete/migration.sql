-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    CONSTRAINT "Snapshot_promptSetVersionId_fkey" FOREIGN KEY ("promptSetVersionId") REFERENCES "PromptSetVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Snapshot" ("actualCost", "analysisId", "callCount", "completedAt", "createdAt", "dualMode", "engines", "errorMessage", "estimatedCost", "id", "promptSetVersionId", "runNumber", "samplesPerPrompt", "status") SELECT "actualCost", "analysisId", "callCount", "completedAt", "createdAt", "dualMode", "engines", "errorMessage", "estimatedCost", "id", "promptSetVersionId", "runNumber", "samplesPerPrompt", "status" FROM "Snapshot";
DROP TABLE "Snapshot";
ALTER TABLE "new_Snapshot" RENAME TO "Snapshot";
CREATE INDEX "Snapshot_analysisId_idx" ON "Snapshot"("analysisId");
CREATE INDEX "Snapshot_promptSetVersionId_idx" ON "Snapshot"("promptSetVersionId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
