// Free, grounded competitor discovery: real news co-mentions (GDELT) instead
// of asking Groq to recall competitor names from training data, which is
// exactly what produced a missed competitor (Unlock), a competitor with no
// domain (Point), and aliases that read as invented. Groq's job here is
// classification (direct vs indirect) and dedup, not recall.
//
// Multiple GDELT queries, not one: searching only the target's own name
// surfaces articles ABOUT the target, whose HEADLINES often don't name its
// competitors at all — but the article BODY often does. Two real articles
// found this way ("Lawmaker moves to clarify home equity investment
// regulation," "Disclosures show CFPB pick ties to several regulated firms")
// each named Point, Hometap, and Unlock together, several paragraphs in,
// with headlines that mention none of them — GDELT's API only returns
// headline/metadata, so without fetching the actual body text, this
// evidence is invisible. Same logic applies to the category-phrase queries
// (a roundup's headline like "5 best X companies for 2026" names nobody
// either). So both the company-name and category queries here fetch full
// article text for their top hits, not just headlines.
import { activeNewsAdapter } from "./news";
import { searchWithDiagnostics } from "./news/diagnostics";
import { fetchArticleText } from "./news/articleText";
import { runReasoningTask } from "./reasoningModel";
import { z } from "zod";

export type CoMentionedBrand = {
  name: string;
  via: "company-name search" | "company-name search (article text)" | "category search" | "category search (article text)";
};

const CoMentionSchema = z.object({
  brands: z.array(z.string()).describe("Company names (not the target itself) that appear as competitors or comparable companies in these headlines — empty array if none"),
});

const LOOKBACK_DAYS = 365;
const MAX_ARTICLE_FETCH = 5;

// A name extracted from search text that's ALSO a common English word
// ("Point," "Unlock," "Better") needs the surrounding text to actually carry
// category language before it's trusted — otherwise a stray phrase like
// "unlock your home's equity" (marketing copy, not a company name) can get
// mistaken for a real competitor mention.
const STOPWORDS = new Set(["and", "the", "for", "with", "that", "this", "from", "your", "into", "without", "company", "companies"]);
const COMMON_WORD_NAMES = new Set(["point", "unlock", "better", "unison", "up", "even", "current", "chime", "affirm", "prosper", "grow", "ally", "brex", "ramp"]);

function deriveContextTerms(category: string): string[] {
  return [
    ...new Set(
      category
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 3 && !STOPWORDS.has(w))
    ),
  ];
}

function isVerifiedIfCommonWord(name: string, sourceText: string, contextTerms: string[]): boolean {
  if (!COMMON_WORD_NAMES.has(name.toLowerCase())) return true;
  if (contextTerms.length === 0) return true;
  const t = sourceText.toLowerCase();
  return contextTerms.some((term) => t.includes(term));
}

async function extractBrandsFromText(companyName: string, category: string, sourceText: string): Promise<string[]> {
  if (!sourceText.trim()) return [];
  const result = await runReasoningTask({
    task: "competitorSuggestions",
    prompt: `Here is real news content related to "${companyName}" (category: ${category}):\n\n${sourceText}\n\nList any real company names (not "${companyName}" itself) that appear in this text as competitors, alternatives, or comparable companies in the same category. Only include a name if it's actually mentioned in the text above — don't add names from general knowledge that aren't in this text. Return an empty array if none appear.`,
    schema: CoMentionSchema,
    heuristicFallback: () => ({ brands: [] }),
  });
  return result.value.brands;
}

async function fetchTopArticleTexts(urls: string[], focusTerm?: string): Promise<string[]> {
  const top = [...new Set(urls)].slice(0, MAX_ARTICLE_FETCH);
  const texts = await Promise.all(top.map((url) => fetchArticleText(url, focusTerm)));
  return texts.filter((t): t is string => t !== null);
}

// Returns [] on any failure (network, rate limit, no results) rather than
// throwing — this is a best-effort signal, not a required dependency. GDELT
// in particular rate-limits aggressively from shared/cloud IPs; a caller
// should treat an empty result as "found nothing," not "definitely no
// competitors exist." Every actual query attempt is logged via
// searchWithDiagnostics regardless of outcome, and searchWithDiagnostics
// itself enforces the shared 5-6s pacing between GDELT requests — every
// await below is sequential, never firing two requests back to back.
export async function findCoMentionedBrands(companyName: string, category: string): Promise<CoMentionedBrand[]> {
  const adapter = activeNewsAdapter();
  const since = new Date();
  since.setDate(since.getDate() - LOOKBACK_DAYS);
  const contextTerms = deriveContextTerms(category);

  const companyResult = await searchWithDiagnostics(adapter, companyName, since, { purpose: "competitor_discovery" });
  const companyHeadlineText = companyResult.articles.slice(0, 30).map((a) => a.title).join("\n");
  const companyArticleTexts = await fetchTopArticleTexts(companyResult.articles.map((a) => a.url), companyName);
  const companyArticleText = companyArticleTexts.join("\n\n---\n\n");

  // Two phrasings of the category query — a plain description and an
  // explicit "companies" roundup phrasing — surface different journalist
  // wording without multiplying queries excessively.
  const categoryQueries = [...new Set([category, `${category} companies`])];
  const categoryArticleLists: { title: string; url: string }[][] = [];
  for (const q of categoryQueries) {
    const result = await searchWithDiagnostics(adapter, q, since, { purpose: "competitor_discovery" });
    categoryArticleLists.push(result.articles.slice(0, 30).map((a) => ({ title: a.title, url: a.url })));
  }
  const categoryArticles = categoryArticleLists.flat();
  const categoryHeadlineText = categoryArticles.map((a) => a.title).join("\n");
  const categoryArticleTexts = await fetchTopArticleTexts(categoryArticles.map((a) => a.url));
  const categoryArticleText = categoryArticleTexts.join("\n\n---\n\n");

  const [fromCompanyHeadlines, fromCompanyArticles, fromCategoryHeadlines, fromCategoryArticles] = await Promise.all([
    extractBrandsFromText(companyName, category, companyHeadlineText).catch(() => []),
    extractBrandsFromText(companyName, category, companyArticleText).catch(() => []),
    extractBrandsFromText(companyName, category, categoryHeadlineText).catch(() => []),
    extractBrandsFromText(companyName, category, categoryArticleText).catch(() => []),
  ]);

  const merged = new Map<string, CoMentionedBrand>();
  const add = (names: string[], sourceText: string, via: CoMentionedBrand["via"]) => {
    for (const name of names) {
      if (merged.has(name.toLowerCase())) continue;
      if (isVerifiedIfCommonWord(name, sourceText, contextTerms)) merged.set(name.toLowerCase(), { name, via });
    }
  };
  add(fromCompanyHeadlines, companyHeadlineText, "company-name search");
  add(fromCompanyArticles, companyArticleText, "company-name search (article text)");
  add(fromCategoryHeadlines, categoryHeadlineText, "category search");
  add(fromCategoryArticles, categoryArticleText, "category search (article text)");
  return [...merged.values()];
}
