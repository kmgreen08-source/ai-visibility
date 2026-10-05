-- CreateTable
CREATE TABLE "JudgeAgreementReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "judgeProvider" TEXT NOT NULL,
    "judgeModel" TEXT NOT NULL,
    "fixturesTested" INTEGER NOT NULL,
    "brandSetMatchPct" INTEGER NOT NULL,
    "positioningMatchPct" INTEGER NOT NULL,
    "sentimentMatchPct" INTEGER NOT NULL,
    "citationMatchPct" INTEGER NOT NULL,
    "consistencyFailures" INTEGER NOT NULL,
    "judgeSelfFlagged" INTEGER NOT NULL,
    "disagreementExamples" TEXT NOT NULL
);
