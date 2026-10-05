/*
  Warnings:

  - Added the required column `orderMatchPct` to the `JudgeAgreementReport` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_JudgeAgreementReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "judgeProvider" TEXT NOT NULL,
    "judgeModel" TEXT NOT NULL,
    "fixturesTested" INTEGER NOT NULL,
    "brandSetMatchPct" INTEGER NOT NULL,
    "orderMatchPct" INTEGER NOT NULL,
    "positioningMatchPct" INTEGER NOT NULL,
    "sentimentMatchPct" INTEGER NOT NULL,
    "citationMatchPct" INTEGER NOT NULL,
    "consistencyFailures" INTEGER NOT NULL,
    "judgeSelfFlagged" INTEGER NOT NULL,
    "disagreementExamples" TEXT NOT NULL
);
INSERT INTO "new_JudgeAgreementReport" ("brandSetMatchPct", "citationMatchPct", "consistencyFailures", "createdAt", "disagreementExamples", "fixturesTested", "id", "judgeModel", "judgeProvider", "judgeSelfFlagged", "positioningMatchPct", "sentimentMatchPct") SELECT "brandSetMatchPct", "citationMatchPct", "consistencyFailures", "createdAt", "disagreementExamples", "fixturesTested", "id", "judgeModel", "judgeProvider", "judgeSelfFlagged", "positioningMatchPct", "sentimentMatchPct" FROM "JudgeAgreementReport";
DROP TABLE "JudgeAgreementReport";
ALTER TABLE "new_JudgeAgreementReport" RENAME TO "JudgeAgreementReport";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
