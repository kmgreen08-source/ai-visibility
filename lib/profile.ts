import { z } from "zod";
import { runReasoningTask, type ReasoningSource } from "./reasoningModel";
import { fetchCompanySitePages, guessDomain, type FetchedPage } from "./siteFetch";
import { findCoMentionedBrands, type CoMentionedBrand } from "./competitorDiscovery";
import type { CompetitorSuggestion } from "./demoCompany";

export const CompetitorSuggestionSchema = z.object({
  name: z.string(),
  url: z.string().nullable().describe("The competitor's website domain, only if you're confident of it — null if unsure. Never invent a URL."),
  type: z
    .enum(["direct", "indirect"])
    .describe("direct = same product category/structure; indirect = an adjacent alternative a buyer might also weigh, but a structurally different product"),
  rationale: z.string().describe("One sentence explaining why this is classified direct or indirect"),
  confidence: z
    .enum(["high", "medium", "low"])
    .describe("How confident this suggestion is relevant to include — high for an obvious same-category player, lower for a judgment call"),
  aliases: z.array(z.string()).describe("Known former names, legal entity names, or common alternate names for this competitor, ONLY if explicitly stated in the provided source text — an empty array otherwise"),
});

export const CompanyProfileSchema = z.object({
  description: z.string().describe("One-line description of what the company does"),
  category: z.string().describe("The product category/market it competes in"),
  audienceType: z.enum(["consumer", "business"]).describe("Who actually buys/uses this — individual consumers, or businesses/organizations"),
  icp: z.string().describe("Ideal customer profile, one short sentence"),
  capabilities: z.array(z.string()).min(3).max(8).describe("Key product capabilities"),
  aliases: z.array(z.string()).describe("The target company's own known former names, legal entity name, or common alternate names, ONLY if explicitly stated in the provided source text — an empty array otherwise"),
});

const CompetitorSuggestionsSchema = z.object({
  competitors: z
    .array(CompetitorSuggestionSchema)
    .min(0)
    .max(6)
    .describe("A mix of real, well-known direct competitors and 1-2 indirect alternatives — fewer than 3 is fine if that's genuinely all the grounded evidence supports"),
});

export type CompanyProfileFields = z.infer<typeof CompanyProfileSchema>;

export type CompanyProfileResult = CompanyProfileFields & {
  suggestedCompetitors: CompetitorSuggestion[];
  profileSource: ReasoningSource;
  competitorsSource: ReasoningSource;
  profileGrounded: boolean;
  competitorsGrounded: boolean;
  aliasesVerified: boolean;
  sources: { url: string; title?: string }[];
};

const HEURISTIC_PROFILE: CompanyProfileFields = {
  description: "Description not available — no reasoning model configured and no manual entry yet.",
  category: "Unknown category",
  audienceType: "consumer",
  icp: "Unknown",
  capabilities: [],
  aliases: [],
};

// Backstop against Groq's free-tier 8000 tokens/minute request cap (the 120b
// model used for profile/competitor tasks) — even with siteFetch's own
// per-page cap, this guards against a future MAX_PAGES increase (or a
// provider swap with a different limit) silently blowing the budget again
// and falling back to the heuristic profile with no visible error.
const MAX_TOTAL_CONTEXT_CHARS = 12000;

function pagesToContext(pages: FetchedPage[]): string {
  let remaining = MAX_TOTAL_CONTEXT_CHARS;
  const parts: string[] = [];
  for (const p of pages) {
    if (remaining <= 0) break;
    const text = p.text.slice(0, remaining);
    parts.push(`--- ${p.url} (${p.title}) ---\n${text}`);
    remaining -= text.length;
  }
  return parts.join("\n\n");
}

// Grounded when possible: fetch the company's own site (free, no search
// API), extract text, and base the profile on that instead of asking Groq to
// recall facts from training data. Falls back to model-knowledge-only (and
// is labeled as such) only when fetching genuinely fails — a blocked/absent
// site, not a lazy default.
export async function generateCompanyProfile(opts: {
  companyName: string;
  companyUrl?: string;
  categoryHint?: string;
}): Promise<CompanyProfileResult> {
  const subject = `"${opts.companyName}"${opts.companyUrl ? ` (${opts.companyUrl})` : ""}${
    opts.categoryHint ? `, category: ${opts.categoryHint}` : ""
  }`;

  const pages = await fetchCompanySitePages(opts.companyUrl || guessDomain(opts.companyName));
  const grounded = pages.length > 0;
  const context = grounded ? pagesToContext(pages) : "";

  const profilePrompt = grounded
    ? `Based ONLY on the following pages fetched from the company's own website, describe ${subject}: what it does, its product category, whether it sells to consumers or businesses, its ideal customer profile, 3-8 key capabilities, and any former/legal/alternate names — ONLY if explicitly stated in the text below (empty array otherwise). Do not add facts not supported by this text.\n\n${context}`
    : `Their website could not be reached, so answer from your training knowledge instead (no live web access — do not claim otherwise, and do not invent a URL or specific figure you're not confident about): describe the company ${subject}. If you don't have reliable knowledge of this company, say so plainly in the description rather than guessing.`;

  const profileResult = await runReasoningTask({
    task: "profile",
    prompt: profilePrompt,
    schema: CompanyProfileSchema,
    heuristicFallback: () => HEURISTIC_PROFILE,
  });

  // Real competitor names come from grounded sources — the company's own
  // comparison pages (if any were fetched) plus real news co-mentions (two
  // independent GDELT queries: the company's own name, and the category
  // phrase — see competitorDiscovery.ts) — not from asking the model to
  // recall a competitive set. Groq's job is classifying/deduping these
  // candidates, never inventing new ones: when grounded, the prompt below
  // explicitly forbids adding anything beyond what's in the candidate list
  // or literally present in the site text, and the result is still checked
  // against both in code afterward (never trust the model's self-restraint
  // alone) — a name that can't be traced to either is dropped rather than
  // shown as if it were grounded.
  const coMentioned = await findCoMentionedBrands(opts.companyName, profileResult.value.category);
  const candidateList = coMentioned.length
    ? `\n\nCompanies recently co-mentioned with ${opts.companyName} in real news coverage: ${coMentioned.map((c) => c.name).join(", ")}.`
    : "\n\nNo companies were found co-mentioned with it in recent news coverage.";

  const competitorsPrompt = grounded
    ? `Based on the following pages from ${opts.companyName}'s own website (category: ${profileResult.value.category}), identify its competitors.${candidateList}\n\nClassify each into direct (same product category/structure) or indirect (adjacent, different structure), with a one-sentence rationale, a confidence level, and any aliases ONLY if explicitly stated in the text below. ONLY include a company that is either (a) named in the co-mention list above, or (b) explicitly named in the site text below — do NOT add any other company from general knowledge, even a well-known one, and do not invent a URL (use null if unsure). If neither source names any real competitor, return an empty list rather than guessing.\n\n${context}`
    : `Their website could not be reached. From your training knowledge (no live web access), suggest competitors for ${subject}, described as: ${profileResult.value.description} (category: ${profileResult.value.category}).${candidateList} Classify direct/indirect with a rationale, confidence, and known aliases (empty array if none). Only name real, currently-operating companies — do not invent names, and use null for the URL rather than guessing.`;

  const competitorsResult = await runReasoningTask({
    task: "competitorSuggestions",
    prompt: competitorsPrompt,
    schema: CompetitorSuggestionsSchema,
    heuristicFallback: () => ({ competitors: [] }),
  });

  const suggestedCompetitors = grounded
    ? attributeCompetitorSources(competitorsResult.value.competitors, coMentioned, context)
    : competitorsResult.value.competitors.map((c) => ({
        ...c,
        discoverySource: "Model knowledge (ungrounded — site unreachable)",
        aliasesVerified: false,
      }));

  return {
    ...profileResult.value,
    suggestedCompetitors,
    profileSource: profileResult.source,
    competitorsSource: competitorsResult.source,
    profileGrounded: grounded,
    competitorsGrounded: grounded,
    aliasesVerified: grounded, // aliases are only ever populated from the provided text when grounded — see the prompt instructions above
    sources: pages.map((p) => ({ url: p.url, title: p.title })),
  };
}

// Code-level ground-truth check on top of the model's own restraint: a
// suggested competitor is only kept if its name is traceable to a real
// source we can point at. This is what makes "show me which source each
// competitor came from" an honest answer rather than the model's opinion of
// its own groundedness.
function attributeCompetitorSources(
  competitors: z.infer<typeof CompetitorSuggestionSchema>[],
  coMentioned: CoMentionedBrand[],
  siteContext: string
): CompetitorSuggestion[] {
  const siteContextLower = siteContext.toLowerCase();
  const coMentionedByName = new Map(coMentioned.map((c) => [c.name.toLowerCase(), c]));

  return competitors
    .map((c): CompetitorSuggestion | null => {
      const coMention = coMentionedByName.get(c.name.toLowerCase());
      if (coMention) {
        // Aliases were extracted from the SITE text prompt, not the news
        // headline that actually named this competitor — that text never
        // mentioned this company at all, so any alias for it can't be
        // verified against it. Keep the name (it's real, from real news),
        // drop trust in the alias unless the model returned none.
        return { ...c, discoverySource: `News co-mention (GDELT, ${coMention.via})`, aliasesVerified: c.aliases.length === 0 };
      }
      if (siteContextLower.includes(c.name.toLowerCase())) {
        return { ...c, discoverySource: "Named in the company's own site text", aliasesVerified: true };
      }
      return null; // can't trace this name to a real source — drop it rather than show it as grounded
    })
    .filter((c): c is CompetitorSuggestion => c !== null);
}
