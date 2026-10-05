import { gdeltAdapter } from "./gdelt";
import { newsapiAdapter } from "./newsapi";
import type { NewsAdapter } from "./types";

// NewsAPI takes priority when a key is configured (higher quality, faster);
// GDELT is the free no-key default.
export function activeNewsAdapter(): NewsAdapter {
  return newsapiAdapter.isConfigured() ? newsapiAdapter : gdeltAdapter;
}

export type { NewsAdapter, NewsArticle } from "./types";
