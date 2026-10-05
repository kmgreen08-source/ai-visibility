-- CreateTable
CREATE TABLE "NewsQueryLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "snapshotId" TEXT,
    "purpose" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "resultCount" INTEGER NOT NULL DEFAULT 0,
    "cached" BOOLEAN NOT NULL DEFAULT false,
    "errorMessage" TEXT,
    "queriedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NewsQueryLog_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "Snapshot" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NewsQueryCache" (
    "query" TEXT NOT NULL PRIMARY KEY,
    "fetchedAt" DATETIME NOT NULL,
    "resultJson" TEXT NOT NULL
);

-- CreateIndex
CREATE INDEX "NewsQueryLog_snapshotId_idx" ON "NewsQueryLog"("snapshotId");
