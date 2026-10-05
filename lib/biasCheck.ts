import { z } from "zod";
import { runReasoningTask, type ReasoningSource } from "./reasoningModel";

export type BiasReason = "product_jargon" | "brand_leak" | "leading_framing";

export type BiasFlag = {
  reason: BiasReason;
  explanation: string;
};

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// The line is realism, not vocabulary difficulty: would an ordinary buyer
// plausibly type this phrase into an AI assistant while researching the
// category? Category-standard names are deliberately NOT flagged, even
// though they sound like industry language — real comparison sites
// literally title articles "Best home equity sharing companies," so a buyer
// typing "home equity investment" or "home equity sharing agreement" is
// realistic, not jargon. What IS flagged is the tier below that: internal,
// legal, or underwriting terminology a buyer would never reach for even
// when describing the same product — e.g. "shared appreciation agreement"
// (the formal contract term) vs. the plain "home equity sharing agreement"
// a buyer actually uses; "servicing obligation" and "flexible underwriting
// criteria" are lender/legal-speak, not buyer language.
export const ALLOWED_CATEGORY_TERMS_NOTE =
  'Category-standard terms (e.g. "home equity investment," "home equity sharing agreement") are allowed through — real buyers use this language. Only internal, legal, or underwriting jargon a buyer would never type gets flagged.';

const JARGON_TERMS = [
  "shared appreciation agreement",
  "servicing obligation",
  "flexible underwriting criteria",
  "option period",
];

// Applied ONLY when the target sells to consumers — these read as B2B/
// industry register even though they're not category-specific legal terms,
// and a real individual buyer researching a personal purchase wouldn't use
// this vocabulary. A B2B buyer legitimately would ("vendors," "platforms"),
// so this list is conditional rather than merged into JARGON_TERMS above.
const CONSUMER_B2B_JARGON_TERMS = ["vendors", "platforms", "cash-out partnership", "equity-sharing platform", "equity-sharing platforms"];

// Mechanical word-swap used only by the no-LLM heuristic fallback — plain
// enough to keep the sentence grammatical without needing a model.
const JARGON_PLAIN_SWAP: Record<string, string> = {
  "shared appreciation agreement": "agreement",
  "servicing obligation": "payment",
  "flexible underwriting criteria": "requirements",
  "option period": "term",
  vendors: "companies",
  platforms: "companies",
  "cash-out partnership": "agreement",
  "equity-sharing platform": "company",
  "equity-sharing platforms": "companies",
};

const LEADING_PATTERN = /\bwhy (is|are|do|does)\b[^?]*\b(better|prefer|preferred)\b/i;

// A spelled-out category phrase ("home equity investment") is realistic
// buyer language (see ALLOWED_CATEGORY_TERMS_NOTE below); the bare category
// acronym isn't — nobody researching this personally types "HEI." Kept as an
// explicit, named list rather than a generic "any all-caps word" pattern —
// that would false-positive on totally normal consumer-finance terms
// (IRA, ATM, PIN, ZIP) that aren't category jargon at all.
const BARE_CATEGORY_ACRONYMS = ["HEI"];
const ACRONYM_EXPANSION: Record<string, string> = { HEI: "home equity investment" };

// Detection only — deterministic and shared by both the live prompt-gen
// pipeline and demo-seeded prompts, so the same rules apply regardless of
// where a prompt came from. Rewriting is a separate step: an LLM call for
// live-generated prompts (see rewritePromptWithLLM below), a fixed lookup
// for the demo's seeded examples — a good rewrite needs judgment a regex
// can't provide, detection doesn't.
export function checkPromptForBias(
  text: string,
  opts: { targetBrand: string; competitors: string[]; intendedBranded: boolean; audienceType?: "consumer" | "business" }
): BiasFlag | null {
  if (!opts.intendedBranded) {
    const allBrands = [opts.targetBrand, ...opts.competitors];
    const hit = allBrands.find((b) =>
      new RegExp(`(^|[^a-z0-9])${escapeRegex(b.toLowerCase())}($|[^a-z0-9])`, "i").test(text)
    );
    if (hit) {
      return {
        reason: "brand_leak",
        explanation: `Names "${hit}" in what's meant to be an unbranded prompt. An unbranded prompt that already names the brand isn't testing real buyer behavior — it's the exact selection-bias pattern this check exists to catch.`,
      };
    }
  }

  const jargonHit = JARGON_TERMS.find((t) => text.toLowerCase().includes(t));
  if (jargonHit) {
    return {
      reason: "product_jargon",
      explanation: `Uses "${jargonHit}" — precise product/industry terminology a real homeowner wouldn't type into an AI assistant. Needs plain buyer language instead.`,
    };
  }

  if (opts.audienceType === "consumer") {
    const consumerJargonHit = CONSUMER_B2B_JARGON_TERMS.find((t) => text.toLowerCase().includes(t));
    if (consumerJargonHit) {
      return {
        reason: "product_jargon",
        explanation: `Uses "${consumerJargonHit}" — this reads as B2B/industry register, not how an individual consumer researching a personal purchase talks.`,
      };
    }
    const acronymHit = BARE_CATEGORY_ACRONYMS.find((a) => new RegExp(`\\b${a}\\b`).test(text));
    if (acronymHit) {
      return {
        reason: "product_jargon",
        explanation: `Uses the bare acronym "${acronymHit}" — a real consumer would type the category out, not use the industry shorthand.`,
      };
    }
  }

  if (LEADING_PATTERN.test(text)) {
    return {
      reason: "leading_framing",
      explanation: `Presupposes the answer ("why is ... better/preferred") instead of asking neutrally. A leading prompt biases the AI's answer before it even responds.`,
    };
  }

  return null;
}

const RewriteSchema = z.object({ rewritten: z.string() });

const GUIDANCE: Record<BiasReason, string> = {
  brand_leak: "Remove any specific brand/company name, keeping the question generic to the product category.",
  product_jargon: "Rewrite in plain language an ordinary buyer would actually type — no industry/product jargon.",
  leading_framing: "Rewrite as a neutral, non-leading question that doesn't presuppose which option is better.",
};

function escapeRegexHeuristic(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// No-LLM fallback so bias-check-on-edit still works with zero keys
// configured (demo mode's whole premise) — mechanical, not as good as an
// LLM rewrite, which is exactly why the UI always offers "keep as written."
function heuristicRewrite(
  text: string,
  reason: BiasReason,
  opts: { targetBrand: string; competitors: string[]; category: string }
): string {
  if (reason === "brand_leak") {
    const allBrands = [opts.targetBrand, ...opts.competitors];
    const hit = allBrands.find((b) => new RegExp(`(^|[^a-z0-9])${escapeRegexHeuristic(b.toLowerCase())}($|[^a-z0-9])`, "i").test(text));
    if (hit) {
      // The category field is a full descriptive sentence ("Home equity
      // investment (HEI) — cash for..."), not a short noun phrase — splicing
      // all of it in would read as broken as the jargon it's fixing. Take
      // just the lead clause before any dash/em-dash.
      const shortCategory = (opts.category || "").split(/[—-]/)[0].trim();
      const lowerFirst = shortCategory ? `${shortCategory.charAt(0).toLowerCase()}${shortCategory.slice(1)}` : "provider in this category";
      return text.replace(
        new RegExp(`(^|[^a-z0-9])${escapeRegexHeuristic(hit)}($|[^a-z0-9])`, "i"),
        (_m, pre: string, post: string, offset: number) => {
          // Avoid "a a home equity..." when the preceding word is already an article.
          const before = text.slice(0, offset + pre.length);
          const precededByArticle = /\b(a|an)\s*$/i.test(before);
          return `${pre}${precededByArticle ? "" : "a "}${lowerFirst}${post}`;
        }
      );
    }
  }
  if (reason === "product_jargon") {
    const hit = [...JARGON_TERMS, ...CONSUMER_B2B_JARGON_TERMS].find((t) => text.toLowerCase().includes(t));
    if (hit) {
      const plain = JARGON_PLAIN_SWAP[hit] ?? "terms";
      return text.replace(new RegExp(escapeRegexHeuristic(hit), "i"), plain);
    }
    const acronymHit = BARE_CATEGORY_ACRONYMS.find((a) => new RegExp(`\\b${a}\\b`).test(text));
    if (acronymHit) {
      const expansion = ACRONYM_EXPANSION[acronymHit] ?? acronymHit;
      return text.replace(new RegExp(`\\b${acronymHit}\\b`), expansion);
    }
  }
  if (reason === "leading_framing") {
    const m = text.match(/why (?:is|are|do|does)\s+(.+?)\s+(?:better|prefer|preferred)(?:\s+than\s+(.+?))?\s*(?:for\s+(.+?))?[.?]?$/i);
    if (m) {
      const [, a, b, purpose] = m;
      const subject = b ? `${a} and ${b}` : a;
      return `What are the differences between ${subject}${purpose ? ` for ${purpose}` : ""}?`;
    }
  }
  return text; // couldn't mechanically fix it — caller still shows the flag + explanation either way
}

// Single entry point both the bulk generator and the edit/add actions use.
// Routes through the shared reasoning layer (cached, rate-limit-aware,
// settings-driven model) and falls back to the mechanical heuristic if no
// key is configured or every attempt fails — same detection either way,
// just a different quality of suggested fix, always labeled with its source.
export async function suggestRewrite(
  text: string,
  reason: BiasReason,
  opts: { targetBrand: string; competitors: string[]; category: string }
): Promise<{ rewritten: string; source: ReasoningSource; flaggedForReview: boolean }> {
  const result = await runReasoningTask({
    task: "biasCheck",
    prompt: `Rewrite this AI-visibility test prompt. ${GUIDANCE[reason]}\n\nOriginal: "${text}"\n\nReturn only the rewritten prompt text.`,
    schema: RewriteSchema,
    heuristicFallback: () => ({ rewritten: heuristicRewrite(text, reason, opts) }),
  });
  return { rewritten: result.value.rewritten, source: result.source, flaggedForReview: result.flaggedForReview };
}

// Shared output shape for both the live and demo prompt-generation paths, so
// the review UI never has to branch on where the data came from.
export type PromptWithBiasCheck = {
  id: string;
  text: string; // final (post-rewrite) text
  theme: string;
  branded: boolean;
  source: ReasoningSource | "manual"; // how the FINAL text was produced — the rewrite's source if bias-checked, else the batch generation's source
  biasFlag: (BiasFlag & { original: string }) | null;
};

export type BiasCheckReportEntry = {
  promptId: string;
  original: string;
  rewritten: string;
  reason: BiasReason;
  explanation: string;
  rewriteSource: ReasoningSource | "manual";
};

export type PromptGenerationResult = {
  prompts: PromptWithBiasCheck[];
  biasChecks: BiasCheckReportEntry[];
};
