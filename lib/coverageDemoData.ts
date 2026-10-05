// Demo-mode seed data for Coverage Impact Tracking, layered on top of the
// Hometap dataset in demoData.ts. Illustrates all three evidence tiers plus
// the guardrails (insufficient-data flag, confounder annotations). Category
// and competitor set are real; the specific headlines, quotes, and numbers
// below are synthetic placeholder content standing in for what a live run
// would produce — not actual claims about Hometap or its competitors. Tier 3
// (visibility lift) numbers are hand-authored to be illustrative — the real
// computation needs a run history across multiple weekly snapshots, which
// the scheduled re-run engine (Step 7 build) produces; this seed data
// establishes the shape the UI renders against ahead of that.

export type CoverageItemSeed = {
  id: string;
  url: string;
  canonicalUrl: string;
  outletName: string;
  outletDomain: string;
  type: "press" | "byline" | "podcast" | "social" | "reddit_forum" | "review_site" | "analyst";
  publishedAt: string;
  title: string;
  summary: string;
  keyClaims: string[];
};

export const DEMO_COVERAGE_ITEMS: CoverageItemSeed[] = [
  {
    id: "cov1",
    url: "https://housingwire.com/hei-vs-heloc-trend",
    canonicalUrl: "housingwire.com/hei-vs-heloc-trend",
    outletName: "HousingWire",
    outletDomain: "housingwire.com",
    type: "press",
    publishedAt: daysAgo(45),
    title: "How home equity investment companies are pitching an alternative to the HELOC",
    summary: "Category-trend piece on home equity investment, naming Hometap alongside other HEI providers and contrasting the no-monthly-payment structure with a traditional HELOC.",
    keyClaims: [
      "No monthly payments or interest during the investment term",
      "Positioned for homeowners who don't qualify for, or don't want, a HELOC",
    ],
  },
  {
    id: "cov2",
    url: "https://trustpilot.com/review/hometap.com",
    canonicalUrl: "trustpilot.com/review/hometap.com",
    outletName: "Trustpilot",
    outletDomain: "trustpilot.com",
    type: "review_site",
    publishedAt: daysAgo(70),
    title: "Hometap — Trustpilot profile",
    summary: "Hometap's Trustpilot profile has grown to several hundred reviews, with a rating solidly above 4 stars among homeowners comparing HEI providers.",
    keyClaims: [
      "Homeowners frequently cite no monthly payment as the main reason for choosing Hometap over a HELOC",
      "Rated favorably on ease of the application process",
    ],
  },
  {
    id: "cov3",
    url: "https://www.reddit.com/r/personalfinance/comments/hometap_vs_heloc_thread",
    canonicalUrl: "reddit.com/r/personalfinance/comments/hometap_vs_heloc_thread",
    outletName: "r/personalfinance",
    outletDomain: "reddit.com",
    type: "reddit_forum",
    publishedAt: daysAgo(30),
    title: "Thread: \"Why we picked a home equity investment over a HELOC\"",
    summary: "A homeowner-authored thread describing why they chose an HEI over a variable-rate HELOC, naming Hometap as the provider they used.",
    keyClaims: ["No monthly payment meant more predictable budgeting than a variable-rate HELOC"],
  },
];

export type CoverageMatchSeed = {
  coverageItemId: string;
  tier: "direct_citation" | "message_echo";
  promptId: string; // matches an id from demoData.ts's prompt set
  engine: string;
  matchedUrl?: string;
  matchedPassage?: string;
  confidence?: number;
};

// Tier 1 & 2 are tied to specific (prompt, engine) answers from the existing
// single-snapshot demo run.
export const DEMO_COVERAGE_MATCHES: CoverageMatchSeed[] = [
  {
    coverageItemId: "cov1",
    tier: "direct_citation",
    promptId: "p5", // "What is the best home equity investment company in 2026?" (Best-in-category theme)
    engine: "perplexity",
    matchedUrl: "https://housingwire.com/hei-vs-heloc-trend",
  },
  {
    coverageItemId: "cov1",
    tier: "message_echo",
    promptId: "p1", // "I need cash but don't want another monthly payment" (Problem/solution theme)
    engine: "openai",
    matchedPassage:
      "Hometap is one of several home equity investment companies that avoid monthly payments entirely, unlike a HELOC, though it means giving up a share of future appreciation.",
    confidence: 0.72,
  },
  {
    coverageItemId: "cov2",
    tier: "message_echo",
    promptId: "p14", // "What can a retiree on a fixed income do..." (Situational theme)
    engine: "anthropic",
    matchedPassage:
      "Reviewers note Hometap's application process is relatively straightforward, which matters for a retiree without traditional income documentation.",
    confidence: 0.65,
  },
];

export type CoverageLiftSeed = {
  coverageItemId: string;
  theme: string;
  preMentionRate: number | null;
  postMentionRate: number | null;
  preAvgPosition: number | null;
  postAvgPosition: number | null;
  preCitationRate: number | null;
  postCitationRate: number | null;
  preRunCount: number;
  postRunCount: number;
  sufficientData: boolean;
  competitorDeltas: { brand: string; preMentionRate: number; postMentionRate: number }[];
  controlThemeDelta: { theme: string; preMentionRate: number; postMentionRate: number };
};

export const DEMO_COVERAGE_LIFTS: CoverageLiftSeed[] = [
  {
    // Enough run history: shows a real (still correlational) lift.
    coverageItemId: "cov1",
    theme: "Situational",
    preMentionRate: 58,
    postMentionRate: 74,
    preAvgPosition: 2.4,
    postAvgPosition: 1.9,
    preCitationRate: 15,
    postCitationRate: 31,
    preRunCount: 6,
    postRunCount: 6,
    sufficientData: true,
    competitorDeltas: [
      { brand: "Point", preMentionRate: 62, postMentionRate: 64 },
      { brand: "Unlock", preMentionRate: 48, postMentionRate: 50 },
    ],
    controlThemeDelta: { theme: "Best-in-category", preMentionRate: 12, postMentionRate: 14 },
  },
  {
    // Guardrail case: too few pre-coverage runs (< 2) to show a lift number at all.
    coverageItemId: "cov3",
    theme: "Use case",
    preMentionRate: null,
    postMentionRate: 55,
    preAvgPosition: null,
    postAvgPosition: 2.2,
    preCitationRate: null,
    postCitationRate: 10,
    preRunCount: 1,
    postRunCount: 4,
    sufficientData: false,
    competitorDeltas: [],
    controlThemeDelta: { theme: "Best-in-category", preMentionRate: 11, postMentionRate: 11 },
  },
];

export type ConfounderEventSeed = {
  kind: "model_change" | "promptset_version_change" | "competitor_news_spike";
  occurredAt: string;
  description: string;
  autoDetected: boolean;
};

export const DEMO_CONFOUNDER_EVENTS: ConfounderEventSeed[] = [
  {
    kind: "promptset_version_change",
    occurredAt: daysAgo(84),
    description: "Prompt set bumped to v2 — added 4 situational prompts (self-employed, retiree, low credit, HELOC-denied) after category review.",
    autoDetected: true,
  },
  {
    kind: "model_change",
    occurredAt: daysAgo(38),
    description: "OpenAI adapter model changed from gpt-4o-search-preview to a newer snapshot returned by the API.",
    autoDetected: true,
  },
  {
    kind: "competitor_news_spike",
    occurredAt: daysAgo(8),
    description: "Point announced a state-expansion for its home equity investment program — coverage volume spiked across tracked outlets.",
    autoDetected: true,
  },
];

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
