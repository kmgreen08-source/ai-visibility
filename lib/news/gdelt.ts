import { createHash } from "crypto";
import { domainOf } from "../brandDetect";
import type { NewsAdapter, NewsArticle } from "./types";

function fmtGdeltDate(d: Date): string {
  // GDELT wants YYYYMMDDHHMMSS
  return d.toISOString().replace(/[-:T]/g, "").slice(0, 14);
}

function hash(url: string): string {
  return createHash("sha1").update(url).digest("hex");
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// GDELT throttles this sandbox's shared outbound IP hard — observed both
// HTTP 429s AND raw connection failures ("fetch failed") in testing, often
// back to back. A prior version only retried on 429 and left a bare `fetch`
// failure to propagate uncaught after one try, which is why it looked like
// retries "weren't working." Two defenses now: (1) a module-level throttle
// enforcing a minimum gap between ANY two requests this process makes, since
// firing requests back to back is what triggers the throttling in the first
// place, and (2) a retry loop that treats every failure mode — network
// error, non-429 HTTP error, AND a non-JSON 200 response (GDELT sometimes
// serves an HTML rate-limit page with a 200 status) — as retryable, not just
// 429s specifically.
const MIN_INTERVAL_MS = 6000;
let lastRequestAt = 0;

async function throttle(): Promise<void> {
  const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [5000, 10000, 20000]; // increasing backoff between the 3 attempts

function parseArticles(data: { articles?: Record<string, unknown>[] }, brand: string): NewsArticle[] {
  const articles = data.articles ?? [];
  return articles
    .map((a): NewsArticle | null => {
      const link = String(a.url ?? "");
      const title = String(a.title ?? "");
      const seendate = String(a.seendate ?? "");
      if (!link || !title) return null;
      // seendate format: YYYYMMDDTHHMMSSZ
      const iso = seendate.length >= 8
        ? `${seendate.slice(0, 4)}-${seendate.slice(4, 6)}-${seendate.slice(6, 8)}`
        : new Date().toISOString().slice(0, 10);
      return {
        brand,
        title,
        url: link,
        domain: domainOf(link),
        publishedAt: iso,
        dedupeHash: hash(title.toLowerCase().trim()),
      };
    })
    .filter((a): a is NewsArticle => a !== null);
}

export const gdeltAdapter: NewsAdapter = {
  key: "gdelt",
  label: "GDELT (free, no key)",
  isConfigured: () => true,
  async search(brand: string, sinceDate: Date): Promise<NewsArticle[]> {
    const url = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
    url.searchParams.set("query", `"${brand}"`);
    url.searchParams.set("mode", "ArtList");
    url.searchParams.set("format", "json");
    url.searchParams.set("maxrecords", "75");
    url.searchParams.set("sort", "DateDesc");
    url.searchParams.set("startdatetime", fmtGdeltDate(sinceDate));
    url.searchParams.set("enddatetime", fmtGdeltDate(new Date()));

    let lastError = "unknown error";
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      await throttle();
      try {
        const res = await fetch(url.toString(), { headers: { "User-Agent": "ai-visibility-pitch-prototype/1.0" } });
        if (res.status === 429) throw new Error("GDELT request failed: 429 (rate limited)");
        if (!res.ok) throw new Error(`GDELT request failed: ${res.status}`);
        const text = await res.text();
        let data: { articles?: Record<string, unknown>[] };
        try {
          data = JSON.parse(text);
        } catch {
          // A 200 with a non-JSON body is GDELT's rate-limit/blocked page, not
          // a genuine empty result — treating it as [] is exactly the "rate
          // limit looks like no articles" failure this is meant to prevent.
          throw new Error(`GDELT returned a non-JSON response (likely rate-limited): ${text.slice(0, 150)}`);
        }
        return parseArticles(data, brand);
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        if (attempt < MAX_ATTEMPTS - 1) {
          await sleep(BACKOFF_MS[attempt]);
          continue;
        }
      }
    }
    throw new Error(lastError);
  },
};
