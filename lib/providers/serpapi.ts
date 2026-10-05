import type { EngineAdapter, EngineResult } from "./types";
import { domainOf } from "../brandDetect";

const EST_COST_PER_CALL_USD = 0.015;

// Optional/stretch provider: Google AI Overview via SerpAPI. Plain REST call
// — SerpAPI has no official AI SDK provider package.
export const serpapiAdapter: EngineAdapter = {
  key: "serpapi",
  label: "Google AI Overview (SerpAPI, optional)",
  isConfigured: () => Boolean(process.env.SERPAPI_KEY),
  supportsWebSearch: true,
  // Google AI Overview is always grounded — no ungrounded variant exists.
  supportsUngroundedMode: false,
  estCostPerCall: EST_COST_PER_CALL_USD,
  async run(prompt: string): Promise<EngineResult> {
    try {
      const url = new URL("https://serpapi.com/search.json");
      url.searchParams.set("engine", "google");
      url.searchParams.set("q", prompt);
      url.searchParams.set("api_key", process.env.SERPAPI_KEY!);

      const res = await fetch(url.toString());
      if (!res.ok) throw new Error(`SerpAPI request failed: ${res.status}`);
      const data = await res.json();

      const overview = data.ai_overview;
      if (!overview) {
        return {
          engine: "serpapi",
          model: "google-ai-overview",
          mode: "grounded",
          status: "ok",
          fullText: "",
          citations: [],
          costUsd: EST_COST_PER_CALL_USD,
          hadWebSearch: true,
        };
      }

      const textParts: string[] = [];
      const citations: { url: string | null; domain: string }[] = [];
      for (const block of overview.text_blocks ?? []) {
        if (block.snippet) textParts.push(block.snippet);
      }
      for (const ref of overview.references ?? []) {
        if (ref.link) citations.push({ url: ref.link, domain: domainOf(ref.link) });
      }

      return {
        engine: "serpapi",
        model: "google-ai-overview",
        mode: "grounded",
        status: "ok",
        fullText: textParts.join("\n\n"),
        citations,
        costUsd: EST_COST_PER_CALL_USD,
        hadWebSearch: true,
      };
    } catch (err) {
      return {
        engine: "serpapi",
        model: "google-ai-overview",
        mode: "grounded",
        status: "error",
        errorMessage: err instanceof Error ? err.message : String(err),
        hadWebSearch: false,
      };
    }
  },
};
