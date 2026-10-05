// Best-effort full-text fetch for a news article URL. GDELT's DOC API only
// returns headline/metadata, not body text, which was the root cause of the
// relevance classifier judging articles as irrelevant from the headline
// alone — a headline like "Lawmaker moves to clarify home equity investment
// regulation" doesn't name Hometap, but the article matched an exact-phrase
// GDELT search for "Hometap", meaning the word appears somewhere in the
// body. Fetching that body is what lets classification actually see it.
//
// A flat prefix truncation isn't enough, though: two real articles tested
// here ran ~8500-9900 characters with the actual Hometap/Point/Unlock
// mention past character 3000 and 5800 respectively (a lede about
// regulation generally, then several paragraphs in, "the three largest
// providers — Point, Hometap and Unlock — originated roughly 54,000
// agreements"). A naive `.slice(0, 3000)` cut off before ever reaching it,
// which is exactly how a genuinely relevant article got misclassified as a
// name collision. When a focus term is given, this centers the extracted
// window on its actual occurrence instead of always keeping the article's
// opening.
import * as cheerio from "cheerio";

const FETCH_TIMEOUT_MS = 6000;
const MAX_TEXT_CHARS = 4000;
const FOCUS_WINDOW_BEFORE = 1200;
const FOCUS_WINDOW_AFTER = 2800;

export async function fetchArticleText(url: string, focusTerm?: string): Promise<string | null> {
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
    $("script, style, nav, footer, noscript, svg, header, aside").remove();
    const fullText = $("body").text().replace(/\s+/g, " ").trim();
    if (fullText.length < 200) return null;

    if (focusTerm) {
      const idx = fullText.toLowerCase().indexOf(focusTerm.toLowerCase());
      if (idx >= FOCUS_WINDOW_BEFORE || (idx !== -1 && idx + FOCUS_WINDOW_AFTER < fullText.length)) {
        const start = Math.max(0, idx - FOCUS_WINDOW_BEFORE);
        const end = Math.min(fullText.length, idx + FOCUS_WINDOW_AFTER);
        return fullText.slice(start, end);
      }
    }
    return fullText.slice(0, MAX_TEXT_CHARS);
  } catch {
    return null;
  }
}
