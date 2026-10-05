import { createPerplexity } from "@ai-sdk/perplexity";
import { generateText } from "ai";
import type { EngineAdapter, EngineResult } from "./types";
import { domainOf } from "../brandDetect";

const EST_COST_PER_CALL_USD = 0.005;
const MODEL = "sonar";

export const perplexityAdapter: EngineAdapter = {
  key: "perplexity",
  label: "Perplexity (Sonar)",
  isConfigured: () => Boolean(process.env.PERPLEXITY_API_KEY),
  supportsWebSearch: true,
  // Sonar is inherently a search model — there's no meaningful "ungrounded"
  // call to compare it against.
  supportsUngroundedMode: false,
  estCostPerCall: EST_COST_PER_CALL_USD,
  async run(prompt: string): Promise<EngineResult> {
    const perplexity = createPerplexity({ apiKey: process.env.PERPLEXITY_API_KEY });
    try {
      const result = await generateText({
        model: perplexity(MODEL),
        prompt,
      });
      // Perplexity returns citations as a provider-metadata array of source
      // URLs rather than inline text — fall back to extracting from the
      // sources array when present.
      const sources = (result.sources ?? [])
        .map((s) => ("url" in s ? s.url : undefined))
        .filter((u): u is string => Boolean(u));
      const citations = sources.map((url) => ({ url, domain: domainOf(url) }));
      return {
        engine: "perplexity",
        model: MODEL,
        mode: "grounded",
        status: "ok",
        fullText: result.text,
        citations,
        costUsd: EST_COST_PER_CALL_USD,
        hadWebSearch: true,
      };
    } catch (err) {
      return {
        engine: "perplexity",
        model: MODEL,
        mode: "grounded",
        status: "error",
        errorMessage: err instanceof Error ? err.message : String(err),
        hadWebSearch: false,
      };
    }
  },
};
