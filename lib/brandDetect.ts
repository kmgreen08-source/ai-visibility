// Ported from the SEON GEO tracker prototype (seon-geo-tracker_9.html), generalized
// so the tracked-brand list is per-analysis instead of hardcoded. Used as a
// deterministic cross-check alongside the LLM-as-judge extraction — regex
// catches exact-name mentions and citations the judge might miss or hallucinate.

export type TrackedBrand = { name: string; aliases: string[] };

export type Citation = { url: string | null; domain: string };

const FIRST_PARTY_HINTS = ["www.", "https://", "http://"];
const REVIEW_DOMAINS = [
  "g2.com",
  "capterra.com",
  "trustradius.com",
  "gartner.com",
  "getapp.com",
  "softwareadvice.com",
  "sourceforge.net",
];
const FORUM_DOMAINS = ["reddit.com", "news.ycombinator.com", "quora.com"];
const WIKI_DOMAINS = ["wikipedia.org"];

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function detectBrand(text: string, aliases: string[]): boolean {
  return aliases.some((a) =>
    new RegExp("(^|[^a-z0-9])" + escapeRegex(a.toLowerCase()) + "($|[^a-z0-9])", "i").test(text)
  );
}

export function firstIndex(text: string, aliases: string[]): number | null {
  const t = text.toLowerCase();
  let best = Infinity;
  for (const a of aliases) {
    const i = t.indexOf(a.toLowerCase());
    if (i >= 0 && i < best) best = i;
  }
  return best === Infinity ? null : best;
}

// Extracts full URLs (preserving query strings — utm tags are how we spot
// platform-seeded sources) plus bare domains not already covered by a URL.
export function extractSources(text: string): Citation[] {
  const out: Citation[] = [];
  const seen = new Set<string>();

  const urlRe = /https?:\/\/[^\s;,)]+/gi;
  let m: RegExpExecArray | null;
  while ((m = urlRe.exec(text)) !== null) {
    const u = m[0].replace(/[.,;)]+$/, "");
    if (seen.has(u)) continue;
    seen.add(u);
    out.push({ url: u, domain: domainOf(u) });
  }

  const domRe = /\b(?:www\.)?([a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)+)\b/gi;
  while ((m = domRe.exec(text)) !== null) {
    const dom = m[1].toLowerCase().replace(/^www\./, "").replace(/[.,;)]+$/, "");
    const parts = dom.split(".");
    if (parts.length < 2 || parts[parts.length - 1].length < 2) continue;
    // Referrer-tag noise, not a real citation.
    if (["chatgpt.com", "openai.com", "perplexity.ai", "google.com"].includes(dom)) continue;
    if (out.some((o) => o.domain === dom)) continue;
    if (seen.has(dom)) continue;
    seen.add(dom);
    out.push({ url: null, domain: dom });
  }
  return out;
}

export function domainOf(url: string): string {
  try {
    return url
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split(/[/?#]/)[0]
      .toLowerCase();
  } catch {
    return url;
  }
}

export type SourceClass = "first" | "review" | "press" | "forum";

export function classifyDomain(
  domain: string,
  ownDomains: string[] = []
): { cls: SourceClass; label: string } {
  const d = domain.toLowerCase();
  if (ownDomains.some((own) => d === own || d.endsWith("." + own))) {
    return { cls: "first", label: "first-party" };
  }
  if (WIKI_DOMAINS.some((x) => d.endsWith(x))) return { cls: "review", label: "wiki" };
  if (REVIEW_DOMAINS.includes(d)) return { cls: "review", label: "review/analyst" };
  if (FORUM_DOMAINS.some((x) => d.endsWith(x))) return { cls: "forum", label: "forum" };
  return { cls: "press", label: "press/other" };
}

// Folds obvious spelling/casing drift on freehand-detected competitor names
// so "Stripe Radar" and "stripe" tally as one brand.
export function canonBrand(raw: string): string | null {
  const s = raw.trim().replace(/\s+/g, " ");
  if (!s) return null;
  return s
    .split(" ")
    .map((w) => (w.length > 2 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");
}

export { FIRST_PARTY_HINTS };
