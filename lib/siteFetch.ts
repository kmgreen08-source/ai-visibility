// Free, no-search-API grounding: fetch the company's own homepage plus a
// handful of likely subpages, extract readable text with cheerio, and hand
// that to Groq instead of asking it to recall facts from training data.
// Also opportunistically follows any on-site comparison/alternatives link it
// finds, since that page is often the best free source of real competitor
// names — a company happily tells you who it thinks its alternatives are.
import * as cheerio from "cheerio";

export type FetchedPage = { url: string; title: string; text: string };

const CANDIDATE_PATHS = ["", "/how-it-works", "/faq", "/faqs", "/about", "/about-us", "/pricing", "/eligibility"];
const COMPARISON_LINK_PATTERN = /\b(vs\.?|versus|alternatives?|compare|competitors?)\b/i;
const MAX_PAGES = 6;
// Groq's free tier caps requests at 8000 tokens/minute for the 120b model —
// 6 pages at the old 6000-char cap (~9000 tokens once combined with the
// prompt and schema) blew straight through that and silently fell back to
// the heuristic profile every time. 2000 chars/page keeps the combined
// context (see MAX_TOTAL_CONTEXT_CHARS in profile.ts) safely under budget
// while still carrying enough of each page for the facts that matter.
const MAX_TEXT_PER_PAGE = 2000;
const FETCH_TIMEOUT_MS = 8000;

function normalizeOrigin(input: string): string {
  const withProtocol = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  try {
    return new URL(withProtocol).origin;
  } catch {
    return withProtocol;
  }
}

// Crude fallback when no URL was given at all — better than nothing, and the
// result is only ever used as a guess to *try* fetching, never asserted as
// fact if the fetch fails.
export function guessDomain(companyName: string): string {
  const slug = companyName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .trim()
    .split(/\s+/)[0];
  return `https://${slug}.com`;
}

async function fetchOne(url: string): Promise<FetchedPage | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ai-visibility-pitch/1.0; +prototype)" },
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("html")) return null;
    const html = await res.text();
    const $ = cheerio.load(html);
    $("script, style, nav, footer, noscript, svg, header").remove();
    const title = $("title").first().text().trim();
    const text = $("body").text().replace(/\s+/g, " ").trim().slice(0, MAX_TEXT_PER_PAGE);
    if (text.length < 200) return null;
    return { url, title, text };
  } catch {
    return null;
  }
}

function findComparisonLinks($: cheerio.CheerioAPI, origin: string): string[] {
  const found = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const anchorText = $(el).text();
    if (!COMPARISON_LINK_PATTERN.test(href) && !COMPARISON_LINK_PATTERN.test(anchorText)) return;
    try {
      const abs = new URL(href, origin);
      if (abs.origin === origin) found.add(abs.toString());
    } catch {
      // relative/invalid href, skip
    }
  });
  return [...found].slice(0, 2);
}

// Returns [] if the site couldn't be reached at all (caller falls back to
// model-knowledge-only and must label the result unverified).
export async function fetchCompanySitePages(companyUrlOrGuess: string): Promise<FetchedPage[]> {
  const origin = normalizeOrigin(companyUrlOrGuess);
  const pages: FetchedPage[] = [];

  const homepage = await fetchOne(origin);
  if (homepage) pages.push(homepage);

  for (const path of CANDIDATE_PATHS.slice(1)) {
    if (pages.length >= MAX_PAGES) break;
    const page = await fetchOne(origin + path);
    if (page) pages.push(page);
  }

  // Follow on-site comparison/alternatives links from whatever we already
  // fetched — this is the free substitute for a competitor-suggestion API.
  if (pages.length > 0 && pages.length < MAX_PAGES) {
    try {
      const homeRes = await fetch(origin, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      const homeHtml = await homeRes.text();
      const $ = cheerio.load(homeHtml);
      const comparisonLinks = findComparisonLinks($, origin);
      for (const link of comparisonLinks) {
        if (pages.length >= MAX_PAGES) break;
        if (pages.some((p) => p.url === link)) continue;
        const page = await fetchOne(link);
        if (page) pages.push(page);
      }
    } catch {
      // homepage re-fetch for link-scanning failed — not fatal, just skip comparison-link discovery
    }
  }

  return pages;
}
