-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_NewsArticle" (
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
    "mentionType" TEXT,
    "classificationSource" TEXT,
    "excluded" BOOLEAN NOT NULL DEFAULT false,
    "exclusionReason" TEXT,
    "syndicatedCount" INTEGER NOT NULL DEFAULT 1,
    "syndicatedOutlets" TEXT,
    CONSTRAINT "NewsArticle_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "Snapshot" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_NewsArticle" ("brand", "classificationSource", "dedupeHash", "domain", "excluded", "exclusionReason", "id", "publishedAt", "sentiment", "snapshotId", "title", "topic", "url") SELECT "brand", "classificationSource", "dedupeHash", "domain", "excluded", "exclusionReason", "id", "publishedAt", "sentiment", "snapshotId", "title", "topic", "url" FROM "NewsArticle";
DROP TABLE "NewsArticle";
ALTER TABLE "new_NewsArticle" RENAME TO "NewsArticle";
CREATE INDEX "NewsArticle_snapshotId_idx" ON "NewsArticle"("snapshotId");
CREATE INDEX "NewsArticle_dedupeHash_idx" ON "NewsArticle"("dedupeHash");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
