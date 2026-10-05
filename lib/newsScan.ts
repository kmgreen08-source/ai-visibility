// Step 4: media landscape scan. For the target company plus every confirmed
// competitor, search recent news via the live GDELT API (or NewsAPI when a
// key is configured — see lib/news/index.ts), gate out true name collisions,
// roll syndicated copies of the same story into one canonical row, then
// classify how the brand is actually mentioned with Groq. Every row stored
// here — title, url, domain — is copied verbatim from the adapter's
// response; nothing about an article is ever generated. This runs
// identically in demo and live mode: there is no seeded/fabricated news
// fallback, in either mode — if GDELT fails or returns nothing, the result
// is an empty or partial scan, not invented coverage. Every search attempt
// (success, empty, rate-limited, error) is logged via searchWithDiagnostics
// so a rate limit is never displayed as if it were "no coverage."
//
// Two design points worth calling out because they weren't obvious from the
// first version:
//
// 1. The pre-Groq "is this even worth classifying" gate for common-word
//    names (Point, Unlock) used to check the HEADLINE for category terms.
//    That's wrong: GDELT indexes full article text, so a headline like
//    "Lawmaker moves to clarify home equity investment regulation" carries
//    no category signal even though the body genuinely discusses "Point,
//    Hometap and Unlock." The gate now checks the fetched article text (or a
//    snippet, when fetch fails) instead of the headline alone.
//
// 2. One real article can — and did — name multiple tracked brands together
//    ("the three largest providers — Point, Hometap and Unlock"). Relying
//    on each brand's own independent GDELT search to surface it is
//    unreliable: GDELT returns at most 75 results per query sorted by date,
//    and a common name's top-75 is dominated by unrelated noise that
//    crowds out an older-but-relevant article a less common name's search
//    still finds. So after fetching an article's text for whichever brand's
//    search surfaced it, this also scans that same text for every OTHER
//    tracked brand and, if found, classifies and counts it for them too —
//    without needing their own search to have found it independently.
import { z } from "zod";
import { prisma } from "./db";
import { activeNewsAdapter, type NewsArticle as FetchedArticle } from "./news";
import { searchWithDiagnostics } from "./news/diagnostics";
import { fetchArticleText } from "./news/articleText";
import { runReasoningTask } from "./reasoningModel";
import { runWithConcurrency } from "./queue";

export const DEFAULT_LOOKBACK_DAYS = 180;
export const WIDE_LOOKBACK_DAYS = 365;
const MAX_INCLUDED_PER_BRAND = 15;
// A safety valve, not a relevance-based limit — bounds worst-case Groq/fetch
// volume if a brand's context-gated candidate pool is unexpectedly huge. The
// per-brand INCLUDED cap is applied afterward, by rank, in phase 2 below.
const MAX_CLASSIFY_SAFETY_CAP = 40;
const TEXT_FETCH_CONCURRENCY = 5;

// --- Category-context terms ---------------------------------------------
const STOPWORDS = new Set(["and", "the", "for", "with", "that", "this", "from", "your", "into", "without", "company", "companies", "service", "services"]);
const COMMON_WORD_BRAND_NAMES = new Set(["point", "unlock", "better", "up", "even", "current", "chime", "affirm", "prosper", "grow", "ally", "brex", "ramp"]);

function deriveCategoryContextTerms(category: string): string[] {
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

function isAmbiguousBrandName(name: string): boolean {
  return COMMON_WORD_BRAND_NAMES.has(name.toLowerCase());
}

// --- Classification (Groq only — no guessed sentiment) -------------------
const MentionSchema = z.object({
  mentionType: z
    .enum(["primary_subject", "quoted_or_cited", "passing_mention", "name_collision"])
    .describe(
      "primary_subject = the piece is centrally about this company; quoted_or_cited = the company is quoted, is the source of data/a survey, or is named as one of several companies in a relevant list; passing_mention = the company appears but isn't central to the piece; name_collision = this is NOT actually about the company at all — the same NAME belongs to something else entirely (a generic word used unrelatedly, OR a completely different real organization that happens to share the name, e.g. a labor union, a place, a person) and the article has nothing to do with the stated category"
    ),
  sentiment: z.enum(["positive", "neutral", "negative"]).describe("Sentiment toward the company specifically — ignored when mentionType is name_collision"),
  topic: z.string().describe("A short 2-4 word topic label, e.g. 'Funding round', 'Product launch', 'Competitive landscape', 'Consumer education', 'Regulatory', 'Survey/data source'."),
});

type Classification =
  | { mentionType: "name_collision" }
  | { mentionType: "primary_subject" | "quoted_or_cited" | "passing_mention"; sentiment: "positive" | "neutral" | "negative" | null; topic: string | null; classificationSource: "groq" | "unclassified" };

async function classifyWithText(brand: string, category: string, title: string, bodyText: string | null): Promise<Classification> {
  const sourceText = bodyText
    ? `HEADLINE: "${title}"\n\nARTICLE TEXT:\n"""\n${bodyText}\n"""`
    : `HEADLINE: "${title}"\n\n(Full article text unavailable — this article matched an exact-phrase news search for "${brand}", so the name appears somewhere in it even though it may not be in the headline. Judge as best you can from the headline and that fact.)`;

  const result = await runReasoningTask({
    task: "newsRelevance",
    prompt: `A news search for "${brand}" (category: ${category || "unknown"}) returned this article:\n\n${sourceText}\n\nClassify how "${brand}" — specifically the company in the "${category}" category, not any other person, place, or organization that happens to share the name — is used in this piece. If the article is actually about a labor union, a place, a person, an unrelated product, or anything else that isn't this company, that is name_collision even if the name appears prominently. Then give sentiment toward the company specifically (skip if name_collision) and a short topic label.`,
    schema: MentionSchema,
    // No key configured: can't verify from body text, so default to the
    // least committal relevant classification rather than dropping real
    // coverage — the exact-phrase GDELT match is still real evidence.
    heuristicFallback: () => ({ mentionType: "passing_mention" as const, sentiment: "neutral" as const, topic: "" }),
  });

  if (result.value.mentionType === "name_collision") return { mentionType: "name_collision" };
  if (result.source === "heuristic") return { mentionType: result.value.mentionType, sentiment: null, topic: null, classificationSource: "unclassified" };
  return { mentionType: result.value.mentionType, sentiment: result.value.sentiment, topic: result.value.topic, classificationSource: "groq" };
}

export type NewsScanBrandStats = {
  brand: string;
  outcome: "success" | "empty" | "rate_limited" | "error";
  cached: boolean;
  errorMessage?: string;
  rawCount: number; // literal count returned by the news adapter
  afterContextFilter: number; // passed the text-based context gate (own search only, not cross-attribution)
  uniqueStories: number; // after rolling up syndicated copies of the same story
  classified: number;
  included: number; // final, non-excluded, stored rows (own search + cross-attributed)
};

const MENTION_WEIGHT: Record<string, number> = { primary_subject: 3, quoted_or_cited: 2, passing_mention: 1 };

type Story = { canonical: FetchedArticle; outlets: string[] };

type Candidate = {
  brand: string;
  story: Story;
  mentionType: "primary_subject" | "quoted_or_cited" | "passing_mention";
  sentiment: "positive" | "neutral" | "negative" | null;
  topic: string | null;
  classificationSource: "groq" | "unclassified";
};

function rowFromCandidate(snapshotId: string, c: Candidate, excluded: boolean, exclusionReason: string | null) {
  return {
    snapshotId,
    brand: c.brand,
    title: c.story.canonical.title,
    url: c.story.canonical.url,
    domain: c.story.canonical.domain,
    publishedAt: new Date(c.story.canonical.publishedAt),
    sentiment: c.sentiment,
    topic: c.topic,
    mentionType: c.mentionType,
    dedupeHash: c.story.canonical.dedupeHash,
    classificationSource: c.classificationSource,
    excluded,
    exclusionReason,
    syndicatedCount: 1 + c.story.outlets.length,
    syndicatedOutlets: c.story.outlets.length > 0 ? JSON.stringify(c.story.outlets) : null,
  };
}

function excludedRow(snapshotId: string, brand: string, a: FetchedArticle, outlets: string[], reason: string) {
  return {
    snapshotId,
    brand,
    title: a.title,
    url: a.url,
    domain: a.domain,
    publishedAt: new Date(a.publishedAt),
    sentiment: null,
    topic: null,
    mentionType: null,
    dedupeHash: a.dedupeHash,
    classificationSource: null,
    excluded: true,
    exclusionReason: reason,
    syndicatedCount: 1 + outlets.length,
    syndicatedOutlets: outlets.length > 0 ? JSON.stringify(outlets) : null,
  };
}

// --- Orchestration --------------------------------------------------------
export async function runNewsScan(snapshotId: string, opts: { lookbackDays?: number; onlyBrands?: string[] } = {}): Promise<NewsScanBrandStats[]> {
  const lookbackDays = opts.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const snapshot = await prisma.snapshot.findUniqueOrThrow({
    where: { id: snapshotId },
    include: { analysis: { include: { profile: true } } },
  });

  await prisma.snapshot.update({ where: { id: snapshotId }, data: { status: "scanning_news", newsScanStatus: "running", newsScanUserConfirmed: false } });

  const profile = snapshot.analysis.profile;
  const confirmed: { name: string }[] = profile ? JSON.parse(profile.confirmedCompetitors) : [];
  const brands = [...new Set([snapshot.analysis.companyName, ...confirmed.map((c) => c.name)])];
  const category = profile?.category ?? "";
  const contextTerms = deriveCategoryContextTerms(category);

  const adapter = activeNewsAdapter();
  const since = new Date();
  since.setDate(since.getDate() - lookbackDays);

  const brandsToSearch = opts.onlyBrands ? brands.filter((b) => opts.onlyBrands!.includes(b)) : brands;
  const skippedBrands = brands.filter((b) => !brandsToSearch.includes(b));

  const stats: NewsScanBrandStats[] = [];
  const excludedToCreate: ReturnType<typeof excludedRow>[] = [];
  const candidatesByBrand = new Map<string, Candidate[]>(brands.map((b) => [b, []]));
  // Tracks which (brand, dedupeHash) pairs already have a candidate this run
  // — own search or cross-attribution — so the same article is never
  // classified twice for the same brand. A brand whose own search is being
  // skipped (resuming only failed queries) is pre-seeded with whatever it
  // already has in the DB, so a cross-attribution from a resumed brand's
  // article can't create a duplicate row for it.
  const seen = new Map<string, Set<string>>(brands.map((b) => [b, new Set<string>()]));
  if (skippedBrands.length > 0) {
    const existing = await prisma.newsArticle.findMany({ where: { snapshotId, brand: { in: skippedBrands } }, select: { brand: true, dedupeHash: true } });
    for (const row of existing) seen.get(row.brand)!.add(row.dedupeHash);
  }

  for (const brand of brandsToSearch) {
    const searchResult = await searchWithDiagnostics(adapter, brand, since, { purpose: "news_scan", snapshotId });

    if (searchResult.outcome === "rate_limited" || searchResult.outcome === "error") {
      // A rate limit or error must never destroy a prior good result for
      // this brand — leave whatever rows already exist untouched.
      stats.push({ brand, outcome: searchResult.outcome, cached: searchResult.cached, errorMessage: searchResult.errorMessage, rawCount: 0, afterContextFilter: 0, uniqueStories: 0, classified: 0, included: 0 });
      continue;
    }

    // A fresh attempt (success or genuinely empty) replaces this brand's own
    // prior rows — cross-attributed rows from OTHER brands' searches (added
    // in phase 2) are untouched by this, since they're inserted afterward.
    await prisma.newsArticle.deleteMany({ where: { snapshotId, brand } });

    if (searchResult.outcome === "empty") {
      stats.push({ brand, outcome: "empty", cached: searchResult.cached, rawCount: 0, afterContextFilter: 0, uniqueStories: 0, classified: 0, included: 0 });
      continue;
    }

    const articles = searchResult.articles;
    for (const a of articles) {
      if (!a.url || !a.title) throw new Error(`News adapter returned a malformed article for "${brand}" — missing url or title`);
    }

    // Roll syndicated copies (same normalized title) into one canonical row.
    const byStory = new Map<string, Story>();
    for (const article of articles) {
      const existing = byStory.get(article.dedupeHash);
      if (existing) existing.outlets.push(article.domain);
      else byStory.set(article.dedupeHash, { canonical: article, outlets: [] });
    }
    const uniqueStories = [...byStory.values()];

    // Fetch article text for every unique story up front — this doubles as
    // both the context-gate signal (body text, not headline) and the input
    // to classification, so nothing is fetched twice.
    const textByHash = new Map<string, string | null>();
    await runWithConcurrency(uniqueStories, TEXT_FETCH_CONCURRENCY, async (story) => {
      textByHash.set(story.canonical.dedupeHash, await fetchArticleText(story.canonical.url, brand));
    });

    const gatePassed: Story[] = [];
    for (const story of uniqueStories) {
      if (!isAmbiguousBrandName(brand) || contextTerms.length === 0) {
        gatePassed.push(story);
        continue;
      }
      const text = (textByHash.get(story.canonical.dedupeHash) ?? story.canonical.title).toLowerCase();
      if (contextTerms.some((t) => text.includes(t))) gatePassed.push(story);
      else excludedToCreate.push(excludedRow(snapshotId, brand, story.canonical, story.outlets, "name-collision filter"));
    }

    const toClassify = gatePassed.slice(0, MAX_CLASSIFY_SAFETY_CAP);
    for (const story of gatePassed.slice(MAX_CLASSIFY_SAFETY_CAP)) {
      excludedToCreate.push(excludedRow(snapshotId, brand, story.canonical, story.outlets, "over safety limit (not classified)"));
    }

    for (const story of toClassify) {
      const text = textByHash.get(story.canonical.dedupeHash) ?? null;
      seen.get(brand)!.add(story.canonical.dedupeHash);
      const result = await classifyWithText(brand, category, story.canonical.title, text);
      if (result.mentionType === "name_collision") {
        excludedToCreate.push(excludedRow(snapshotId, brand, story.canonical, story.outlets, "name collision (groq)"));
        continue;
      }
      candidatesByBrand.get(brand)!.push({ brand, story, mentionType: result.mentionType, sentiment: result.sentiment, topic: result.topic, classificationSource: result.classificationSource });

      // Cross-brand attribution: the same article can name several tracked
      // brands. Reuse the already-fetched text rather than a fresh search.
      if (text) {
        const lowerText = text.toLowerCase();
        for (const other of brands) {
          if (other === brand) continue;
          if (seen.get(other)!.has(story.canonical.dedupeHash)) continue;
          if (!lowerText.includes(other.toLowerCase())) continue;
          seen.get(other)!.add(story.canonical.dedupeHash);
          const otherResult = await classifyWithText(other, category, story.canonical.title, text);
          if (otherResult.mentionType === "name_collision") continue;
          candidatesByBrand.get(other)!.push({ brand: other, story, mentionType: otherResult.mentionType, sentiment: otherResult.sentiment, topic: otherResult.topic, classificationSource: otherResult.classificationSource });
        }
      }
    }

    stats.push({ brand, outcome: "success", cached: searchResult.cached, rawCount: articles.length, afterContextFilter: gatePassed.length, uniqueStories: uniqueStories.length, classified: toClassify.length, included: 0 });
  }

  // Phase 2: the per-brand cap applies AFTER classification, ranked by how
  // central the mention is and then recency — never before classification,
  // and never to something still unclassified.
  const includedToCreate: ReturnType<typeof rowFromCandidate>[] = [];
  for (const brand of brands) {
    const candidates = candidatesByBrand.get(brand)!;
    candidates.sort((a, b) => MENTION_WEIGHT[b.mentionType] - MENTION_WEIGHT[a.mentionType] || new Date(b.story.canonical.publishedAt).getTime() - new Date(a.story.canonical.publishedAt).getTime());
    const included = candidates.slice(0, MAX_INCLUDED_PER_BRAND);
    const overCap = candidates.slice(MAX_INCLUDED_PER_BRAND);

    for (const c of included) includedToCreate.push(rowFromCandidate(snapshotId, c, false, null));
    for (const c of overCap) includedToCreate.push(rowFromCandidate(snapshotId, c, true, "over per-brand cap"));

    const stat = stats.find((s) => s.brand === brand);
    if (stat) stat.included = included.length;
  }

  if (excludedToCreate.length > 0) await prisma.newsArticle.createMany({ data: excludedToCreate });
  if (includedToCreate.length > 0) await prisma.newsArticle.createMany({ data: includedToCreate });

  // Phase 3: cross-attribution against EVERY currently-included article for
  // this snapshot, not just ones freshly processed above. This matters when
  // a brand's own query fails (rate-limited) in this call but another
  // brand's ALREADY-STORED article — from an earlier successful call — also
  // names it: without this, that co-mention is only ever discovered if the
  // mentioning brand happens to be freshly re-processed in the same run
  // that the failing brand also succeeds in, which isn't reliable under
  // GDELT's intermittent throttling. Article body text isn't persisted, so
  // this re-fetches it for whatever's already included (a small, known-good
  // set — cheap compared to the original per-brand candidate pools).
  await crossAttributeFromExistingArticles(snapshotId, brands, category);

  // Status reflects ALL tracked brands, not just the ones this call actually
  // searched — a "resume failed only" run must still report the true
  // overall state, including brands that succeeded in an earlier call.
  const newsScanStatus = await computeOverallNewsScanStatus(snapshotId, brands);
  await prisma.snapshot.update({ where: { id: snapshotId }, data: { newsScanStatus, newsScanAt: new Date() } });

  return stats;
}

async function crossAttributeFromExistingArticles(snapshotId: string, brands: string[], category: string): Promise<void> {
  const allIncluded = await prisma.newsArticle.findMany({ where: { snapshotId, excluded: false } });
  const hashesByBrand = new Map<string, Set<string>>(brands.map((b) => [b, new Set(allIncluded.filter((a) => a.brand === b).map((a) => a.dedupeHash))]));
  const toCreate: NonNullable<Parameters<typeof prisma.newsArticle.createMany>[0]>["data"] = [];

  for (const article of allIncluded) {
    // Only worth checking brands this article doesn't already cover.
    const missingBrands = brands.filter((b) => b !== article.brand && !hashesByBrand.get(b)!.has(article.dedupeHash));
    if (missingBrands.length === 0) continue;

    const text = await fetchArticleText(article.url, article.brand);
    if (!text) continue;
    const lowerText = text.toLowerCase();

    for (const other of missingBrands) {
      if (!lowerText.includes(other.toLowerCase())) continue;
      const result = await classifyWithText(other, category, article.title, text);
      if (result.mentionType === "name_collision") continue;
      hashesByBrand.get(other)!.add(article.dedupeHash);
      toCreate.push({
        snapshotId,
        brand: other,
        title: article.title,
        url: article.url,
        domain: article.domain,
        publishedAt: article.publishedAt,
        sentiment: result.sentiment,
        topic: result.topic,
        mentionType: result.mentionType,
        dedupeHash: article.dedupeHash,
        classificationSource: result.classificationSource,
        excluded: false,
        exclusionReason: null,
        syndicatedCount: article.syndicatedCount,
        syndicatedOutlets: article.syndicatedOutlets,
      });
    }
  }

  if (toCreate.length > 0) await prisma.newsArticle.createMany({ data: toCreate });
}

async function computeOverallNewsScanStatus(snapshotId: string, brands: string[]): Promise<"complete" | "partial" | "failed"> {
  const logs = await prisma.newsQueryLog.findMany({ where: { snapshotId, purpose: "news_scan" }, orderBy: { queriedAt: "desc" } });
  const latestByBrand = new Map<string, string>(); // brand -> outcome
  for (const log of logs) if (!latestByBrand.has(log.query)) latestByBrand.set(log.query, log.outcome);
  const outcomes = brands.map((b) => latestByBrand.get(b) ?? "error");
  const anyFailed = outcomes.some((o) => o === "rate_limited" || o === "error");
  if (!anyFailed) return "complete";
  return outcomes.every((o) => o === "rate_limited" || o === "error") ? "failed" : "partial";
}

// A human override for the excluded-articles view — the pipeline's filters
// (name-collision, per-brand cap, Groq relevance) are heuristics and can be
// wrong; restoring un-excludes a real article without re-running the scan or
// losing the record of why it was filtered.
export async function restoreNewsArticle(articleId: string): Promise<void> {
  await prisma.newsArticle.update({ where: { id: articleId }, data: { excluded: false } });
}

// Resume only the brands whose last attempt failed (rate-limited or errored)
// — a brand that already succeeded keeps its data untouched, and its query
// is never re-issued (see the onlyBrands scoping in runNewsScan above).
export async function resumeFailedNewsQueries(snapshotId: string): Promise<NewsScanBrandStats[]> {
  const logs = await prisma.newsQueryLog.findMany({ where: { snapshotId, purpose: "news_scan" }, orderBy: { queriedAt: "desc" } });
  const latestByQuery = new Map<string, (typeof logs)[number]>();
  for (const log of logs) if (!latestByQuery.has(log.query)) latestByQuery.set(log.query, log);
  const failedBrands = [...latestByQuery.values()].filter((l) => l.outcome === "rate_limited" || l.outcome === "error").map((l) => l.query);
  if (failedBrands.length === 0) return [];
  return runNewsScan(snapshotId, { onlyBrands: failedBrands });
}
