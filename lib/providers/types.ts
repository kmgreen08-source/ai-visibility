// Measured AI-visibility engines only — Groq is intentionally excluded (see
// lib/providers/index.ts) since it's the reasoning workhorse, never a
// measured surface.
export type EngineKey = "openai" | "anthropic" | "gemini" | "perplexity" | "serpapi";

export type RunMode = "grounded" | "ungrounded";

export type EngineResult = {
  engine: EngineKey;
  model: string;
  mode: RunMode;
  status: "ok" | "error";
  fullText?: string;
  citations?: { url: string | null; domain: string }[];
  errorMessage?: string;
  costUsd?: number;
  // True when this engine call included live web search/grounding. Kept
  // alongside `mode` (rather than derived from it) because a "grounded"
  // request can still come back without any sources actually used.
  hadWebSearch: boolean;
};

export type EngineAdapter = {
  key: EngineKey;
  label: string;
  isConfigured: () => boolean;
  supportsWebSearch: boolean;
  // Whether calling this engine WITHOUT search is meaningful. Some surfaces
  // (e.g. Google AI Overview via SerpAPI) are inherently always grounded, so
  // there's no real "ungrounded" mode to run as a comparison.
  supportsUngroundedMode: boolean;
  // Rough per-call cost estimate in USD, for the pre-run cost display —
  // not billing-accurate, just enough to show the user what they're about
  // to spend before confirming.
  estCostPerCall: number;
  run: (prompt: string, opts?: { mode?: RunMode }) => Promise<EngineResult>;
};
