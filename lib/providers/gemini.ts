import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText } from "ai";
import type { EngineAdapter, EngineResult } from "./types";
import { extractSources } from "../brandDetect";

const EST_COST_PER_CALL_USD = 0.005;
const MODEL = "gemini-2.5-flash";

export const geminiAdapter: EngineAdapter = {
  key: "gemini",
  label: "Gemini (Google)",
  isConfigured: () => Boolean(process.env.GOOGLE_AI_API_KEY),
  supportsWebSearch: true,
  supportsUngroundedMode: true,
  estCostPerCall: EST_COST_PER_CALL_USD,
  async run(prompt: string, opts): Promise<EngineResult> {
    const mode = opts?.mode ?? "grounded";
    const google = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_AI_API_KEY });
    try {
      const { text } = await generateText({
        model: google(MODEL),
        prompt,
        ...(mode === "grounded" ? { tools: { google_search: google.tools.googleSearch({}) } } : {}),
      });
      return {
        engine: "gemini",
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
        engine: "gemini",
        model: MODEL,
        mode,
        status: "error",
        errorMessage: err instanceof Error ? err.message : String(err),
        hadWebSearch: false,
      };
    }
  },
};
