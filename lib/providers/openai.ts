import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import type { EngineAdapter, EngineResult } from "./types";
import { extractSources } from "../brandDetect";

const EST_COST_PER_CALL_USD = 0.01;
const GROUNDED_MODEL = "gpt-4o-search-preview";
const UNGROUNDED_MODEL = "gpt-4o-mini";

export const openaiAdapter: EngineAdapter = {
  key: "openai",
  label: "ChatGPT (OpenAI)",
  isConfigured: () => Boolean(process.env.OPENAI_API_KEY),
  supportsWebSearch: true,
  supportsUngroundedMode: true,
  estCostPerCall: EST_COST_PER_CALL_USD,
  async run(prompt: string, opts): Promise<EngineResult> {
    const mode = opts?.mode ?? "grounded";
    const modelName = mode === "grounded" ? GROUNDED_MODEL : UNGROUNDED_MODEL;
    const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
    try {
      const { text } = await generateText({
        model: openai(modelName),
        prompt,
      });
      return {
        engine: "openai",
        model: modelName,
        mode,
        status: "ok",
        fullText: text,
        citations: mode === "grounded" ? extractSources(text) : [],
        costUsd: EST_COST_PER_CALL_USD,
        hadWebSearch: mode === "grounded",
      };
    } catch (err) {
      return {
        engine: "openai",
        model: modelName,
        mode,
        status: "error",
        errorMessage: err instanceof Error ? err.message : String(err),
        hadWebSearch: false,
      };
    }
  },
};
