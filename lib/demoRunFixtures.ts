// Renders realistic-looking raw AI-answer text FROM the ground-truth mention
// data in demoData.ts, so the two are always consistent by construction (the
// text actually names the brands the structured data says are present, in
// the same order) rather than being two hand-authored artifacts that could
// drift apart. Style varies by engine to look like a real multi-engine run.
import { buildDemoDataset } from "./demoData";
import { buildDemoPromptGeneration } from "./promptGenDemo";
import type { MentionRow } from "./metrics";
import type { EngineKey } from "./providers/types";
import type { JudgeExtraction } from "./judge";

// buildDemoRunFixtures() below keys its map by the transient generation-time
// staging id (e.g. "p3", "pb6") — the same id demoData.ts's mentions/citations
// use. The real Prompt rows in the DB get their own cuid, created in the same
// order, so orderIndex is the stable bridge between the two (same pattern as
// the bias-check-record fix).
export function demoStagingIdsByOrderIndex(): string[] {
  return buildDemoPromptGeneration().prompts.map((p) => p.id);
}

export type DemoRunFixture = {
  promptId: string;
  engine: EngineKey;
  rawText: string;
  citations: { url: string | null; domain: string }[];
  mentions: MentionRow[]; // ground truth for this (prompt, engine) run
};

// Deterministic, always-fails case so the run engine's retry/backoff/partial-
// results handling is genuinely exercised in demo mode, not just claimed.
export const DEMO_SIMULATED_FAILURE: { promptId: string; engine: EngineKey } = { promptId: "p1", engine: "gemini" };

// Multiple phrasing variants per positioning, picked deterministically by a
// hash of (prompt, brand, engine) — a prior version had exactly one sentence
// per positioning, so every "alternative" mention across the whole demo read
// as a byte-identical template. This keeps determinism (same fixture always
// renders the same text) while avoiding the repeated-sentence pattern.
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
function pickVariant<T>(variants: readonly T[], seed: number): T {
  return variants[seed % variants.length];
}

const LEADER_PHRASES: ((b: string) => string)[] = [
  (b) => `${b} is one of the names that comes up most often here`,
  (b) => `${b} tends to dominate this conversation`,
  (b) => `${b} is usually the first name mentioned`,
  (b) => `most people researching this end up looking closely at ${b}`,
];
const ALTERNATIVE_PHRASES: ((b: string) => string)[] = [
  (b) => `${b} is another option worth a look`,
  (b) => `${b} also comes up as a solid alternative`,
  (b) => `${b} is worth considering as well`,
  (b) => `you'll also see ${b} mentioned as a reasonable choice`,
];
const NICHE_PHRASES: ((b: string) => string)[] = [
  (b) => `${b} tends to fit a narrower set of situations`,
  (b) => `${b} is more of a fit for specific circumstances`,
  (b) => `${b} shows up mainly for particular cases`,
];
const SECONDARY_PHRASES: ((b: string) => string)[] = [
  (b) => `${b} gets mentioned too, though less prominently`,
  (b) => `${b} comes up, but further down the list`,
  (b) => `${b} is in the mix, just not a top pick`,
];
const MISPOSITIONED_PHRASES: ((b: string) => string)[] = [
  (b) => `${b} is sometimes described as a reverse-mortgage or home-equity-loan provider, though its actual structure is a home equity investment — no debt, no monthly payment, just a share of future value`,
  (b) => `${b} occasionally gets lumped in with loan products, even though it's structured as an equity investment rather than debt`,
];

function brandClause(m: MentionRow): string {
  const seed = hashStr(`${m.promptId}::${m.brand}::${m.engine}`);
  switch (m.positioning) {
    case "leader":
      return pickVariant(LEADER_PHRASES, seed)(m.brand);
    case "alternative":
      return pickVariant(ALTERNATIVE_PHRASES, seed)(m.brand);
    case "niche":
      return pickVariant(NICHE_PHRASES, seed)(m.brand);
    case "secondary":
      return pickVariant(SECONDARY_PHRASES, seed)(m.brand);
    case "mispositioned":
      return pickVariant(MISPOSITIONED_PHRASES, seed)(m.brand);
    default:
      return `${m.brand} also comes up`;
  }
}

function renderOpenAI(themeIntro: string, ordered: MentionRow[]): string {
  const clauses = ordered.map(brandClause);
  return `${themeIntro} A few names come up regularly: ${clauses.join("; ")}. Overall it depends on your specific situation — your credit profile, how much equity you have, and whether you're comfortable trading some future appreciation for cash today with no monthly payment.`;
}

function renderAnthropic(themeIntro: string, ordered: MentionRow[]): string {
  const clauses = ordered.map(brandClause);
  return `${themeIntro} I'd point to a few options, though I'd encourage you to verify current terms directly since these agreements vary by state and change over time. ${clauses
    .map((c) => c.charAt(0).toUpperCase() + c.slice(1) + ".")
    .join(" ")} That said, this isn't financial advice — it's worth comparing actual offers before committing to anything.`;
}

function renderGemini(themeIntro: string, ordered: MentionRow[]): string {
  const bullets = ordered.map((m) => `• ${m.brand} — ${brandClause(m).replace(`${m.brand} `, "")}`);
  return `${themeIntro}\n\n${bullets.join("\n")}\n\nFees, funding caps, and eligibility requirements differ across these, so it's worth comparing actual quotes rather than relying on general reputation.`;
}

function renderPerplexity(themeIntro: string, ordered: MentionRow[], citations: { domain: string }[]): string {
  const numbered = citations.slice(0, 4);
  const clauses = ordered.map((m, i) => {
    const cite = numbered.length ? ` [${(i % numbered.length) + 1}]` : "";
    return `${brandClause(m)}${cite}`;
  });
  const sources = numbered.map((c, i) => `[${i + 1}] ${c.domain}`).join("\n");
  return `${themeIntro} ${clauses.join(". ")}.${sources ? `\n\nSources:\n${sources}` : ""}`;
}

const NO_DOMINANT_TEXT = "There isn't a single dominant name here — it really depends on what you're optimizing for, so it's worth comparing a few quotes directly.";

function renderForEngine(engine: EngineKey, themeIntro: string, ordered: MentionRow[], citations: { domain: string }[]): string {
  if (ordered.length === 0) return `${themeIntro} ${NO_DOMINANT_TEXT}`;
  switch (engine) {
    case "openai":
      return renderOpenAI(themeIntro, ordered);
    case "anthropic":
      return renderAnthropic(themeIntro, ordered);
    case "gemini":
      return renderGemini(themeIntro, ordered);
    case "perplexity":
      return renderPerplexity(themeIntro, ordered, citations);
    default:
      return renderOpenAI(themeIntro, ordered);
  }
}

const DEFAULT_INTRO = "Here's what's worth knowing about home equity investment options.";
const THEME_INTRO: Record<string, string> = {
  "Problem/solution": "If you're trying to get cash from your home without adding a monthly payment, home equity investment (HEI) companies are one path worth knowing about.",
  "Best-in-category": "When people ask about the best home equity investment companies, a handful of names dominate the conversation.",
  "Use case": "For that kind of situation, a home equity investment is one structure to consider alongside more traditional options.",
  "Life situation": "That's a common situation for people looking at home equity investments specifically because they don't have the traditional income/credit profile a bank wants for a HELOC.",
  "Comparison/evaluation": "It's worth comparing a few structural differences before deciding between a home equity investment and other ways to access equity.",
};

export function buildDemoRunFixtures(): Map<string, DemoRunFixture> {
  const ds = buildDemoDataset();
  const byKey = new Map<string, DemoRunFixture>();

  for (const run of ds.runs) {
    const key = `${run.promptId}::${run.engine}`;
    if (byKey.has(key)) continue;

    const mentionsForRun = ds.mentions
      .filter((m) => m.promptId === run.promptId && m.engine === run.engine)
      .sort((a, b) => a.rank - b.rank);
    const citationsForRun = ds.citations.filter((c) => c.promptId === run.promptId && c.engine === run.engine);
    const themeIntro = THEME_INTRO[run.theme] ?? DEFAULT_INTRO;
    const rawText = renderForEngine(run.engine as EngineKey, themeIntro, mentionsForRun, citationsForRun);

    byKey.set(key, {
      promptId: run.promptId,
      engine: run.engine as EngineKey,
      rawText,
      citations: citationsForRun.map((c) => ({ url: null, domain: c.domain })),
      mentions: mentionsForRun,
    });
  }

  return byKey;
}

// Ungrounded ("no live search") mode: without fresh retrieval, a model leans
// on generic training knowledge, which surfaces only the most flatly-
// established fact (whoever is the outright category leader) and drops
// weaker, more contextual mentions — this is the concrete mechanism behind
// "search-off shows weaker Hometap visibility," applied consistently to both
// the rendered text and the stored ground truth (never just one of the two,
// which is exactly the drift that caused the raw-text-vs-extraction
// complaint in grounded mode previously).
export function applyDemoMode(fixture: DemoRunFixture, mode: "grounded" | "ungrounded"): DemoRunFixture {
  if (mode === "grounded") return fixture;

  const weakened = fixture.mentions
    .filter((m) => !(m.isTarget && m.positioning !== "leader"))
    .map((m, i) => ({ ...m, rank: i + 1 }));
  const theme = fixture.mentions[0]?.theme ?? "";
  const themeIntro = THEME_INTRO[theme] ?? DEFAULT_INTRO;
  const rawText = renderForEngine(fixture.engine, themeIntro, weakened, []);

  return { ...fixture, mentions: weakened, rawText, citations: [] };
}

// Demo mode's "seeded judge output" when no reasoning-capable key is
// configured: the ground truth already computed for the fixture text IS the
// correct extraction (the text was generated from it), so there's no need to
// fabricate a separate mock judge result — just reshape it.
export function groundTruthExtraction(mentions: MentionRow[]): JudgeExtraction {
  return {
    brandMentions: mentions.map((m) => ({
      brand: m.brand,
      rank: m.rank,
      positioning: m.positioning,
      sentiment: m.sentiment,
      description: brandClause(m),
      ownDomainCited: m.ownDomainCited,
    })),
    otherBrandsMentioned: [],
  };
}
