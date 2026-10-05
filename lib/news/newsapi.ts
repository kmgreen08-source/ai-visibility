import { createHash } from "crypto";
import { domainOf } from "../brandDetect";
import type { NewsAdapter, NewsArticle } from "./types";

function hash(url: string): string {
  return createHash("sha1").update(url).digest("hex");
}

export const newsapiAdapter: NewsAdapter = {
  key: "newsapi",
  label: "NewsAPI (optional, needs key)",
  isConfigured: () => Boolean(process.env.NEWSAPI_KEY),
  async search(brand: string, sinceDate: Date): Promise<NewsArticle[]> {
    const url = new URL("https://newsapi.org/v2/everything");
    url.searchParams.set("q", `"${brand}"`);
    url.searchParams.set("from", sinceDate.toISOString().slice(0, 10));
    url.searchParams.set("sortBy", "publishedAt");
    url.searchParams.set("pageSize", "75");
    url.searchParams.set("language", "en");

    const res = await fetch(url.toString(), {
      headers: { "X-Api-Key": process.env.NEWSAPI_KEY! },
    });
    if (!res.ok) throw new Error(`NewsAPI request failed: ${res.status}`);
    const data = await res.json();

    return (data.articles ?? []).map(
      (a: { url: string; title: string; publishedAt: string }): NewsArticle => ({
        brand,
        title: a.title,
        url: a.url,
        domain: domainOf(a.url),
        publishedAt: a.publishedAt.slice(0, 10),
        dedupeHash: hash(a.title.toLowerCase().trim()),
      })
    );
  },
};
