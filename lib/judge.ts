import { z } from "zod";
import { runReasoningTask, type ReasoningSource } from "./reasoningModel";

export const BrandMentionSchema = z.object({
  brand: z.string().describe("Exact brand name as it appears or is clearly referenced"),
  rank: z.number().int().min(1).describe("Order this brand was mentioned in, 1 = first"),
  positioning: z
    .enum(["leader", "alternative", "niche", "secondary", "mispositioned"])
    .describe(
      "leader = presented as top/best-in-category; alternative = one reasonable option among several; " +
        "niche = framed as narrow/specialized fit only; secondary = mentioned in passing without real endorsement; " +
        "mispositioned = described inaccurately relative to what the brand actually does"
    ),
  sentiment: z.enum(["positive", "neutral", "negative"]),
  description: z
    .string()
    .describe("One short quote-free sentence summarizing how the answer characterizes this brand"),
  ownDomainCited: z.boolean().describe("True only if the brand's own domain appears in the citations"),
});

export const JudgeExtractionSchema = z.object({
  brandMentions: z.array(BrandMentionSchema),
  otherBrandsMentioned: z
    .array(z.string())
    .describe("Any competitor/brand names mentioned that are not on the tracked list"),
});

export type JudgeExtraction = z.infer<typeof JudgeExtractionSchema>;

export type TrackedBrandWithAliases = { name: string; aliases: string[] };

export type JudgeResult = {
  extraction: JudgeExtraction;
  judgeModel: string | null;
  judgeSource: ReasoningSource;
  wasRetried: boolean;
  flaggedForReview: boolean;
  rateLimited: boolean;
};

const EMPTY_EXTRACTION: JudgeExtraction = { brandMentions: [], otherBrandsMentioned: [] };

// Routes through the shared reasoning layer: settings-driven model, cached,
// Groq-concurrency-gated, retries once with the validation error fed back on
// failure, then falls back to an empty (clearly flagged) extraction rather
// than crashing the run over one bad response.
export async function judgeResponse(opts: {
  responseText: string;
  citations: { url: string | null; domain: string }[];
  trackedBrands: TrackedBrandWithAliases[];
}): Promise<JudgeResult> {
  const citationList = opts.citations.map((c) => c.domain).join(", ") || "(none captured)";
  const brandList = opts.trackedBrands
    .map((b) => (b.aliases.length ? `${b.name} (also known as: ${b.aliases.join(", ")})` : b.name))
    .join(", ");

  const prompt = `You are analyzing one AI assistant's answer to a buyer-intent question, to measure brand visibility.

TRACKED BRANDS (the ones we care about — a mention of any listed alias counts as a mention of that brand): ${brandList}

CITED DOMAINS in this answer: ${citationList}

ANSWER TEXT:
"""
${opts.responseText}
"""

Extract every tracked brand that is actually mentioned in the answer text, INCLUDING a mention that only uses one of its known aliases rather than the primary name (skip brands not mentioned at all — do not invent a rank for them). For each one mentioned, determine its rank by mention order, how it's positioned, the sentiment toward it, a one-sentence quote-free description, and whether its own domain is among the cited domains. Also list any other competitor/brand names mentioned that are not on the tracked list.`;

  const result = await runReasoningTask({
    task: "judge",
    prompt,
    schema: JudgeExtractionSchema,
    heuristicFallback: () => EMPTY_EXTRACTION,
  });

  return {
    extraction: result.value,
    judgeModel: result.modelName,
    judgeSource: result.source,
    wasRetried: result.wasRetried,
    flaggedForReview: result.flaggedForReview,
    rateLimited: result.rateLimited,
  };
}
