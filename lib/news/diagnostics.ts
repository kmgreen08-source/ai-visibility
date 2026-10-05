// Every call site that hits a news adapter (the Step 4 scan, competitor
// discovery) goes through here instead of calling adapter.search() directly.
// Two jobs: (1) serve a recent cached response instead of re-hitting a
// rate-limited API for the same query, and (2) log the real outcome of every
// attempt — success/empty/rate_limited/error — so "GDELT returned nothing"
// is never silently indistinguishable from "GDELT was rate-limited."
import { prisma } from "../db";
import type { NewsAdapter, NewsArticle } from "./types";

const CACHE_TTL_MS = 15 * 60 * 1000;

export type NewsSearchOutcome = "success" | "empty" | "rate_limited" | "error";

export type NewsSearchResult = {
  articles: NewsArticle[];
  outcome: NewsSearchOutcome;
  cached: boolean;
  errorMessage?: string;
};

function classifyError(message: string): "rate_limited" | "error" {
  return /429|rate.?limit/i.test(message) ? "rate_limited" : "error";
}

export async function searchWithDiagnostics(
  adapter: NewsAdapter,
  query: string,
  since: Date,
  opts: { purpose: "news_scan" | "competitor_discovery"; snapshotId?: string }
): Promise<NewsSearchResult> {
  const cacheKey = `${adapter.key}::${query.toLowerCase().trim()}`;
  const cached = await prisma.newsQueryCache.findUnique({ where: { query: cacheKey } });
  if (cached && Date.now() - cached.fetchedAt.getTime() < CACHE_TTL_MS) {
    const articles: NewsArticle[] = JSON.parse(cached.resultJson);
    await logQuery(opts, query, articles.length > 0 ? "success" : "empty", articles.length, true);
    return { articles, outcome: articles.length > 0 ? "success" : "empty", cached: true };
  }

  try {
    const articles = await adapter.search(query, since);
    await prisma.newsQueryCache.upsert({
      where: { query: cacheKey },
      create: { query: cacheKey, fetchedAt: new Date(), resultJson: JSON.stringify(articles) },
      update: { fetchedAt: new Date(), resultJson: JSON.stringify(articles) },
    });
    const outcome: NewsSearchOutcome = articles.length > 0 ? "success" : "empty";
    await logQuery(opts, query, outcome, articles.length, false);
    return { articles, outcome, cached: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const outcome = classifyError(message);
    await logQuery(opts, query, outcome, 0, false, message);
    return { articles: [], outcome, cached: false, errorMessage: message };
  }
}

async function logQuery(
  opts: { purpose: "news_scan" | "competitor_discovery"; snapshotId?: string },
  query: string,
  outcome: NewsSearchOutcome,
  resultCount: number,
  cached: boolean,
  errorMessage?: string
): Promise<void> {
  await prisma.newsQueryLog.create({
    data: { snapshotId: opts.snapshotId, purpose: opts.purpose, query, outcome, resultCount, cached, errorMessage },
  });
}
