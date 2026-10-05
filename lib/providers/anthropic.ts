import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import type { EngineAdapter, EngineResult } from "./types";
import { extractSources } from "../brandDetect";

const EST_COST_PER_CALL_USD = 0.015;
const MODEL = "claude-sonnet-5";

export const anthropicAdapter: EngineAdapter = {
  key: "anthropic",
  label: "Claude (Anthropic)",
  isConfigured: () => Boolean(process.env.ANTHROPIC_API_KEY),
  supportsWebSearch: true,
  supportsUngroundedMode: true,
  estCostPerCall: EST_COST_PER_CALL_USD,
  async run(prompt: string, opts): Promise<EngineResult> {
    const mode = opts?.mode ?? "grounded";
    const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    try {
      const { text } = await generateText({
        model: anthropic(MODEL),
        prompt,
        ...(mode === "grounded"
          ? { tools: { web_search: anthropic.tools.webSearch_20250305({ maxUses: 5 }) } }
          : {}),
      });
      return {
        engine: "anthropic",
        model: MODEL,
        mode,
        status: "ok",
        fullText: text,
        citations: mode === "grounded" ? extractSources(text) : [],
        costUsd: EST_COST_PER_CALL_USD,
        hadWebSearch: mode === "grounded",
      };
    } catch (err) {
      return {
        engine: "anthropic",
        model: MODEL,
        mode,
        status: "error",
        errorMessage: err instanceof Error ? err.message : String(err),
        hadWebSearch: false,
      };
    }
  },
};
