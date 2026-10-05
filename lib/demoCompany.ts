// Shared Hometap demo constants. Split out from demoData.ts so both that
// file and promptGenDemo.ts can depend on it without a circular import.
// Facts below (credit score, legal entity names, competitor structures) were
// checked against public sources rather than assumed — this is a real
// company, so seeded "facts" need to actually be facts, not just plausible.
export const DEMO_COMPANY = {
  name: "Hometap",
  url: "hometap.com",
  aliases: ["Hometap Equity Partners"], // its registered legal entity name
  audienceType: "consumer" as const,
  category: "Home equity investment (HEI) — cash for home equity with no loan and no monthly payment",
  icp: "Homeowners with significant equity who want cash without taking on debt, a second mortgage, or a monthly payment — often people who don't qualify for or don't want a HELOC",
  description:
    "Hometap gives homeowners cash today in exchange for a share of their home's future value, with no monthly payments and no interest — an alternative to a home equity loan or HELOC.",
  capabilities: [
    "Lump-sum cash investment in exchange for a share of future home value",
    "No monthly payments or interest during the investment term",
    "Lower credit score requirement than a typical HELOC",
    "Settlement due at sale, refinance, or buyout within the term",
    "Available in a defined set of US states",
  ],
};

// Seeded source list standing in for what a live browser_search-backed
// profile lookup would return. Demo mode never calls a live model, so this
// is what the "sources used to build this profile" section shows instead.
export const DEMO_PROFILE_SOURCES = [
  { url: "https://www.hometap.com/how-it-works", title: "Hometap — How It Works" },
  { url: "https://www.hometap.com/faqs", title: "Hometap — Frequently Asked Questions" },
  { url: "https://themortgagereports.com/126252/hometap-review", title: "Hometap Review 2026: Terms, Access and Customer Feedback" },
  { url: "https://money.com/best-home-equity-sharing-companies/", title: "5 Best Home Equity Sharing Companies" },
];

export type CompetitorSuggestion = {
  name: string;
  url: string | null;
  type: "direct" | "indirect";
  rationale: string;
  confidence: "high" | "medium" | "low";
  aliases: string[];
  aliasesVerified: boolean; // true only if the aliases came from a real source (site text, news, or the user) — see profile.ts
  discoverySource: string; // where the NAME itself was found — "Company's own site text" | "News co-mention (GDELT, ...)" | "Added manually by the agency user" | a demo-specific label. Shown in the UI so a suggestion is never presented as grounded when it wasn't.
};

// What a profile-generation pass would suggest for Hometap: a mixed list the
// confirmation screen splits into direct vs indirect, defaulting to direct
// only selected — this is the scenario that motivates the confirmation step
// existing at all (a naive prompt set would otherwise blend HEI competitors
// with HELOC lenders and muddy the whole analysis).
export const DEMO_COMPETITOR_SUGGESTIONS: CompetitorSuggestion[] = [
  {
    name: "Point",
    url: "point.com",
    type: "direct",
    rationale: "Also a home equity investment company — same product structure (cash for a share of future home value, no monthly payments).",
    confidence: "high",
    aliases: ["Point Digital Finance"],
    aliasesVerified: true, // verified via web search when this demo dataset was built
    discoverySource: "News co-mention (GDELT) + Hometap site comparison context, checked when this demo dataset was built",
  },
  {
    name: "Unlock",
    url: "unlock.com",
    type: "direct",
    rationale: "Also a home equity investment company, with a partial-buyback option — same category as Hometap.",
    confidence: "high",
    aliases: ["Unlock Technologies"],
    aliasesVerified: true, // verified via web search when this demo dataset was built
    discoverySource: "News co-mention (GDELT) + Hometap site comparison context, checked when this demo dataset was built",
  },
  {
    name: "Unison",
    url: "unison.com",
    type: "direct",
    rationale: "Also a home equity investment company, available in a broad set of states — same category as Hometap.",
    confidence: "high",
    aliases: [],
    aliasesVerified: true, // verified via web search when this demo dataset was built
    discoverySource: "News co-mention (GDELT), checked when this demo dataset was built",
  },
  {
    name: "Rocket Mortgage",
    url: "rocketmortgage.com",
    type: "indirect",
    rationale: "A HELOC/home equity loan lender, not an equity-sharing company — a buyer might compare it, but it's a structurally different product (debt with monthly payments, not a share of future value).",
    confidence: "medium",
    aliases: ["Rocket Companies"],
    aliasesVerified: true, // verified via web search when this demo dataset was built
    discoverySource: "Category-adjacent lender, added by the analyst building this demo dataset",
  },
  {
    name: "Better",
    url: "better.com",
    type: "indirect",
    rationale: "A mortgage and home equity loan lender — an alternative a homeowner might weigh, but not a direct home-equity-investment competitor.",
    confidence: "medium",
    aliases: ["Better.com", "Better Mortgage"],
    aliasesVerified: true, // verified via web search when this demo dataset was built
    discoverySource: "Category-adjacent lender, added by the analyst building this demo dataset",
  },
];

// Default confirmed set = the direct competitors only.
export const DEMO_COMPETITORS = DEMO_COMPETITOR_SUGGESTIONS.filter((c) => c.type === "direct").map((c) => c.name);
export const DEMO_BRANDS = [DEMO_COMPANY.name, ...DEMO_COMPETITORS];
