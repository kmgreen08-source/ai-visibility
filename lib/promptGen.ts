import { z } from "zod";
import { runReasoningTask } from "./reasoningModel";
import { checkPromptForBias, suggestRewrite, type PromptGenerationResult } from "./biasCheck";

export const GeneratedPromptSchema = z.object({
  text: z.string(),
  theme: z.string().describe("Short theme label matching one of the themes specified in the instructions"),
  branded: z.boolean().describe("True only if the prompt names the target company or a competitor by name"),
});

export const PromptSetSchema = z.object({
  unbranded: z
    .array(GeneratedPromptSchema)
    .min(18)
    .max(30)
    .describe("Unbranded, capability/buyer-intent-framed prompts grouped into the specified themes"),
  branded: z
    .array(GeneratedPromptSchema)
    .min(3)
    .max(8)
    .describe("A small secondary set of explicitly branded prompts, e.g. '[Company] vs [Competitor]'"),
});

export type PromptSetResult = z.infer<typeof PromptSetSchema>;
export type AudienceType = "consumer" | "business";

function heuristicPromptSet(opts: { companyName: string; category: string; competitors: string[] }): PromptSetResult {
  // No LLM available: a small, honest, generic template set rather than
  // nothing — clearly labeled "heuristic" so it reads as a starting point to
  // hand-edit, not a real generated set.
  const cat = opts.category || "this category";
  return {
    unbranded: [
      { text: `What is the best option for ${cat}?`, theme: "Best-in-category", branded: false },
      { text: `How do I choose between options for ${cat}?`, theme: "Comparison/evaluation", branded: false },
      { text: `What should I look for when evaluating ${cat} options?`, theme: "Comparison/evaluation", branded: false },
    ],
    branded: opts.competitors[0]
      ? [{ text: `${opts.companyName} vs ${opts.competitors[0]}`, theme: "Comparison/evaluation", branded: true }]
      : [],
  };
}

// Consumer and B2B buyers research completely differently — a consumer never
// asks about "verticals" or "vendors," and a B2B buyer's evaluation really
// does vary by industry. Branching the whole instruction set (not just
// swapping one word) is what actually produces prompts in the right
// register, rather than B2B-flavored language leaking into a consumer tool.
function buildInstructions(opts: { companyName: string; category: string; icp: string; competitors: string[]; audienceType: AudienceType }): string {
  const header = `You are building a prompt set to measure AI-assistant visibility for a company in the "${opts.category}" category, whose ICP is: ${opts.icp}. The company is "${opts.companyName}"; its competitors are: ${opts.competitors.join(", ")}.`;

  const unbrandedInstructions =
    opts.audienceType === "consumer"
      ? `1. UNBRANDED prompts (18-30 total): the kind of question a real individual buyer would actually type into ChatGPT/Gemini/Perplexity — plain, everyday language, NEVER mention "${opts.companyName}" or any competitor by name, and NEVER use industry/B2B jargon (no "vendors," "platforms," "solutions," or bare category acronyms — spell things out the way a normal person would). Group them into exactly these 5 themes: "Problem/solution" (a situation they're trying to solve), "Best-in-category" (what's the best/top option), "Use case" (a specific thing they want to do with the money/product), "Life situation" (a specific personal circumstance — e.g. retiree on fixed income, self-employed and can't easily prove income, already has bad credit, already got turned down by a bank/lender — NOT an industry or "vertical"), and "Comparison/evaluation" (how to evaluate options, without naming brands). Never use the word "vertical" or an industry-segment framing — this is a consumer product, not a B2B one. Selection-bias warning: do not write these as if you already know "${opts.companyName}" is the answer — write them the way an uninformed buyer actually would.`
      : `1. UNBRANDED prompts (18-30 total): the kind of question a real business buyer would type into ChatGPT/Gemini/Perplexity while researching this category — NEVER mention "${opts.companyName}" or any competitor by name. Group them into 4-6 themes: problem/solution framing, best-in-category / "what's the top X for Y", specific use case, vertical/industry-specific need, and comparison-style questions that don't name brands (e.g. "how do I evaluate vendors for X"). Selection-bias warning: do not write these as if you already know "${opts.companyName}" is the answer — write them the way an uninformed buyer actually would.`;

  return `${header}

Generate two sets:

${unbrandedInstructions}

2. BRANDED prompts (3-8 total): a small clearly-separate set that DOES name "${opts.companyName}" and/or a competitor, e.g. "${opts.companyName} vs [competitor]" or "is ${opts.companyName} good for [use case]". These are tracked separately and excluded from headline unbranded metrics.

Mark each prompt's "branded" field correctly, and use exactly the theme names given above.`;
}

export async function generatePromptSet(opts: {
  companyName: string;
  category: string;
  icp: string;
  competitors: string[];
  audienceType: AudienceType;
}): Promise<{ value: PromptSetResult; source: Awaited<ReturnType<typeof runReasoningTask>>["source"] }> {
  const result = await runReasoningTask({
    task: "promptGeneration",
    prompt: buildInstructions(opts),
    schema: PromptSetSchema,
    heuristicFallback: () => heuristicPromptSet(opts),
  });
  return { value: result.value, source: result.source };
}

// Wraps generatePromptSet() with the same bias-check pass the demo pipeline
// runs (lib/promptGenDemo.ts) — every generated prompt is checked with
// checkPromptForBias(), and anything flagged gets a suggested rewrite via
// the shared reasoning layer (LLM if configured, heuristic otherwise).
// Returns the same shape as the demo path so the review UI never branches on
// the source.
export async function generatePromptSetWithBiasCheck(opts: {
  companyName: string;
  category: string;
  icp: string;
  competitors: string[];
  audienceType: AudienceType;
}): Promise<PromptGenerationResult> {
  const raw = await generatePromptSet(opts);
  const biasChecks: PromptGenerationResult["biasChecks"] = [];

  async function process(list: PromptSetResult["unbranded"], idPrefix: string) {
    return Promise.all(
      list.map(async (p, i) => {
        const id = `${idPrefix}${i + 1}`;
        const flag = checkPromptForBias(p.text, {
          targetBrand: opts.companyName,
          competitors: opts.competitors,
          intendedBranded: p.branded,
          audienceType: opts.audienceType,
        });
        if (!flag) {
          return { id, text: p.text, theme: p.theme, branded: p.branded, source: raw.source, biasFlag: null };
        }
        const { rewritten, source: rewriteSource } = await suggestRewrite(p.text, flag.reason, {
          targetBrand: opts.companyName,
          competitors: opts.competitors,
          category: opts.category,
        });
        biasChecks.push({ promptId: id, original: p.text, rewritten, reason: flag.reason, explanation: flag.explanation, rewriteSource });
        return { id, text: rewritten, theme: p.theme, branded: p.branded, source: rewriteSource, biasFlag: { ...flag, original: p.text } };
      })
    );
  }

  const [unbranded, branded] = await Promise.all([process(raw.value.unbranded, "p"), process(raw.value.branded, "pb")]);

  return { prompts: [...unbranded, ...branded], biasChecks };
}
