// Demo-mode prompt generation for Hometap. Unlike the rest of demoData.ts
// (which is static seeded output), this module actually runs the real
// checkPromptForBias() detector — the same function the live pipeline uses —
// against a seeded "raw" candidate list that deliberately includes 4 flawed
// prompts (one per bias type, including the consumer-vs-B2B jargon check).
// This demonstrates the bias-check step working rather than just asserting
// that it works. Rewrites for the demo's flawed examples are a fixed lookup
// (no LLM call needed for known text, tagged source "heuristic"); live mode
// calls suggestRewrite() instead, which routes through Groq.
import { checkPromptForBias, type PromptGenerationResult } from "./biasCheck";
import { DEMO_COMPANY, DEMO_COMPETITORS } from "./demoCompany";

export type ThemeKey = "Problem/solution" | "Best-in-category" | "Use case" | "Life situation" | "Comparison/evaluation";

type RawCandidate = { text: string; theme: ThemeKey; branded: boolean };

// 20 unbranded candidates, consumer-register themes (never "Vertical" — this
// is a B2C product). Indices 3, 7, 8, and 19 (1-based) are deliberately
// flawed — brand leak, formal/legal jargon, consumer-vs-B2B jargon, and
// leading framing — to demonstrate the bias-check step visibly catching and
// rewriting real problems rather than just asserting it works.
const RAW_UNBRANDED: RawCandidate[] = [
  { text: "I need cash but don't want another monthly payment — what are my options besides a HELOC?", theme: "Problem/solution", branded: false },
  { text: "How can I access my home equity without taking on more debt?", theme: "Problem/solution", branded: false },
  { text: "My credit score isn't great — how can I still tap into my home's equity through a shared appreciation agreement with flexible underwriting criteria?", theme: "Problem/solution", branded: false }, // FLAW: product_jargon (formal/legal)
  { text: "What are the downsides of trading future home equity for cash today?", theme: "Problem/solution", branded: false },
  { text: "What is the best home equity investment company in 2026?", theme: "Best-in-category", branded: false },
  { text: "Top companies that offer home equity sharing agreements", theme: "Best-in-category", branded: false },
  { text: "Does Hometap have the lowest fees among home equity investment companies?", theme: "Best-in-category", branded: false }, // FLAW: brand_leak
  { text: "Which equity-sharing platforms are most transparent about fees?", theme: "Best-in-category", branded: false }, // FLAW: product_jargon (consumer/B2B register)
  { text: "What's a good option for a homeowner who wants a lump sum instead of a line of credit?", theme: "Use case", branded: false },
  { text: "I want to pay off high-interest debt using my home equity without a second mortgage — what should I look at?", theme: "Use case", branded: false },
  { text: "What's the best way to fund a home renovation without a construction loan?", theme: "Use case", branded: false },
  { text: "I need a down payment for a second home — can I use a home equity investment for that?", theme: "Use case", branded: false },
  { text: "What are good home equity options for a self-employed homeowner who can't easily prove income?", theme: "Life situation", branded: false },
  { text: "What can a retiree on a fixed income do to access home equity without monthly payments?", theme: "Life situation", branded: false },
  { text: "Are there home equity products for someone who already has a low credit score?", theme: "Life situation", branded: false },
  { text: "What's available for a homeowner who was denied a HELOC by their bank?", theme: "Life situation", branded: false },
  { text: "How do I evaluate home equity investment companies before signing an agreement?", theme: "Comparison/evaluation", branded: false },
  { text: "What questions should I ask before doing a home equity sharing deal?", theme: "Comparison/evaluation", branded: false },
  { text: "Why is a home equity investment better than a reverse mortgage for avoiding monthly payments?", theme: "Comparison/evaluation", branded: false }, // FLAW: leading_framing
  { text: "Is it worth giving up a share of my home's future value for cash today?", theme: "Comparison/evaluation", branded: false },
];

const RAW_BRANDED: RawCandidate[] = [
  { text: "Hometap vs Point — which is better?", theme: "Comparison/evaluation", branded: true },
  { text: "Is Hometap a good option for a homeowner with average credit?", theme: "Comparison/evaluation", branded: true },
  { text: "Hometap vs Unlock — how do the terms compare?", theme: "Comparison/evaluation", branded: true },
  { text: "Hometap reviews and fees", theme: "Comparison/evaluation", branded: true },
  { text: "Hometap vs Unison for a homeowner in a high-appreciation market", theme: "Comparison/evaluation", branded: true },
  { text: "Is Hometap better than Point for a smaller investment amount?", theme: "Comparison/evaluation", branded: true },
];

// Fixed rewrites for the demo's known flawed candidates — a real pipeline
// would call suggestRewrite() here instead (see promptGen.ts).
const DEMO_REWRITES: Record<string, string> = {
  "My credit score isn't great — how can I still tap into my home's equity through a shared appreciation agreement with flexible underwriting criteria?":
    "My credit score isn't great — how can I still tap into my home's equity?",
  "Does Hometap have the lowest fees among home equity investment companies?":
    "Which home equity investment company has the lowest fees?",
  "Which equity-sharing platforms are most transparent about fees?":
    "Which home equity investment companies are most transparent about fees?",
  "Why is a home equity investment better than a reverse mortgage for avoiding monthly payments?":
    "What's the difference between a home equity investment and a reverse mortgage?",
};

export function buildDemoPromptGeneration(): PromptGenerationResult {
  const biasChecks: PromptGenerationResult["biasChecks"] = [];

  const unbranded = RAW_UNBRANDED.map((c, i) => {
    const id = `p${i + 1}`;
    const flag = checkPromptForBias(c.text, {
      targetBrand: DEMO_COMPANY.name,
      competitors: DEMO_COMPETITORS,
      intendedBranded: c.branded,
      audienceType: DEMO_COMPANY.audienceType,
    });
    if (flag) {
      const rewritten = DEMO_REWRITES[c.text] ?? c.text;
      biasChecks.push({ promptId: id, original: c.text, rewritten, reason: flag.reason, explanation: flag.explanation, rewriteSource: "heuristic" });
      return { id, text: rewritten, theme: c.theme, branded: c.branded, source: "heuristic" as const, biasFlag: { ...flag, original: c.text } };
    }
    return { id, text: c.text, theme: c.theme, branded: c.branded, source: "heuristic" as const, biasFlag: null };
  });

  const branded = RAW_BRANDED.map((c, i) => {
    const id = `pb${i + 1}`;
    // Branded candidates are intentionally allowed to name brands — bias
    // check still runs (jargon/leading framing could still apply) but brand
    // mentions won't trip brand_leak here.
    const flag = checkPromptForBias(c.text, {
      targetBrand: DEMO_COMPANY.name,
      competitors: DEMO_COMPETITORS,
      intendedBranded: true,
      audienceType: DEMO_COMPANY.audienceType,
    });
    if (flag) {
      const rewritten = DEMO_REWRITES[c.text] ?? c.text;
      biasChecks.push({ promptId: id, original: c.text, rewritten, reason: flag.reason, explanation: flag.explanation, rewriteSource: "heuristic" });
      return { id, text: rewritten, theme: c.theme, branded: c.branded, source: "heuristic" as const, biasFlag: { ...flag, original: c.text } };
    }
    return { id, text: c.text, theme: c.theme, branded: c.branded, source: "heuristic" as const, biasFlag: null };
  });

  return { prompts: [...unbranded, ...branded], biasChecks };
}
