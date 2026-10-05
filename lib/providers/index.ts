import type { EngineAdapter, EngineKey } from "./types";
import { openaiAdapter } from "./openai";
import { anthropicAdapter } from "./anthropic";
import { geminiAdapter } from "./gemini";
import { perplexityAdapter } from "./perplexity";
import { serpapiAdapter } from "./serpapi";

// Groq is deliberately NOT registered here. It's this app's workhorse
// reasoning model (profile, prompt generation, bias check, judge, news
// classification — see lib/reasoningModel.ts) but must never be one of the
// measured AI-visibility engines: it isn't a consumer AI surface a buyer
// actually uses, so its output can't stand in for ChatGPT/Claude/Gemini/
// Perplexity results without misrepresenting what the visibility data means.
export const ADAPTERS: Record<EngineKey, EngineAdapter> = {
  openai: openaiAdapter,
  anthropic: anthropicAdapter,
  gemini: geminiAdapter,
  perplexity: perplexityAdapter,
  serpapi: serpapiAdapter,
};

export function configuredEngines(): EngineAdapter[] {
  return Object.values(ADAPTERS).filter((a) => a.isConfigured());
}

export function allEngines(): EngineAdapter[] {
  return Object.values(ADAPTERS);
}

export type { EngineAdapter, EngineKey, EngineResult } from "./types";
