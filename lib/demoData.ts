// Seeded, fully offline demo dataset — no API keys, no network calls. Uses a
// real, recognizable company (Hometap) so the demo reads as credible rather
// than a toy example, but every AI answer/news item below is synthetic
// placeholder text standing in for what a live run would produce — none of
// it is an actual claim about Hometap, its real competitors, or their real
// coverage. Category and competitor set are real (home equity investment);
// specifics like headlines and quotes are illustrative only.
//
// Brand presence is a DELIBERATE, hand-authored narrative, not a random
// walk — a prior version rolled dice per (prompt, engine) and occasionally
// produced results that read as arbitrary rather than as a story an agency
// could actually brief a prospect on. The narrative:
//   - Point leads most themes overall.
//   - Hometap is strong on Best-in-category and specifically the fees
//     prompt, but is a real gap on the two Life-situation/Use-case prompts
//     about retirees and debt payoff — competitors show up, Hometap doesn't.
//   - One Best-in-category mention (gemini) mispositions Hometap as a
//     reverse-mortgage/loan product — the single most common real category
//     confusion here; a second Best-in-category prompt has Hometap simply
//     missing on Claude specifically, a flat omission rather than a mix-up.
//   - Perplexity cites personal-finance review sites heavily and always
//     cites whatever it mentions; other engines only reliably cite the
//     brand they call the outright leader. Perplexity also surfaces Hometap
//     more consistently on Use-case prompts than the other three engines.
//   - ChatGPT alone also names Unison on the retiree/fixed-income prompt —
//     Hometap is still absent there either way (that's the gap), but the
//     rest of the answer isn't identical across engines.
// This file is also now fully deterministic (no PRNG) — a prior version
// used a module-level random generator whose state didn't reset between
// calls, so calling buildDemoDataset() more than once per process (which
// happened routinely once dev-server requests accumulated) produced a
// DIFFERENT dataset each time, silently breaking the "raw text always
// matches its extraction" guarantee. Determinism here isn't just narrative
// control, it's a correctness fix.
import type { MentionRow, RunRow, CitationRow } from "./metrics";
import type { EngineKey } from "./providers/types";
import { buildDemoPromptGeneration, type ThemeKey } from "./promptGenDemo";

export { DEMO_COMPANY, DEMO_COMPETITORS, DEMO_BRANDS, DEMO_COMPETITOR_SUGGESTIONS } from "./demoCompany";
import { DEMO_COMPANY, DEMO_BRANDS } from "./demoCompany";

const ENGINES: EngineKey[] = ["openai", "anthropic", "gemini", "perplexity"];

type Positioning = "leader" | "alternative" | "niche" | "secondary" | "mispositioned";
type BrandSlot = { brand: string; positioning: Positioning };

// Default brand presence per theme, in rank order. Hometap absent from a
// theme's default list is deliberate where the narrative calls for it
// (Life situation) — not every theme needs all four brands to feel real.
const THEME_TEMPLATE: Record<ThemeKey, BrandSlot[]> = {
  "Problem/solution": [
    { brand: "Point", positioning: "leader" },
    { brand: "Hometap", positioning: "alternative" },
    { brand: "Unlock", positioning: "secondary" },
  ],
  "Best-in-category": [
    { brand: "Point", positioning: "leader" },
    { brand: "Hometap", positioning: "leader" },
    { brand: "Unison", positioning: "alternative" },
  ],
  "Use case": [
    { brand: "Unlock", positioning: "leader" },
    { brand: "Point", positioning: "alternative" },
    { brand: "Hometap", positioning: "secondary" },
  ],
  "Life situation": [
    { brand: "Point", positioning: "alternative" },
    { brand: "Unlock", positioning: "secondary" },
  ],
  "Comparison/evaluation": [
    { brand: "Point", positioning: "leader" },
    { brand: "Hometap", positioning: "alternative" },
    { brand: "Unlock", positioning: "alternative" },
    { brand: "Unison", positioning: "niche" },
  ],
};

// Per-prompt-id overrides layered on top of the theme default — this is
// where the specific, identifiable narrative beats live. `engineOverrides`
// replaces the slot list for ONE specific engine only, on top of `slots`/the
// theme default for every other engine — this is what makes engines
// genuinely disagree with each other sometimes, rather than four identical
// copies of the same answer.
const PROMPT_OVERRIDES: Record<
  string,
  { slots?: BrandSlot[]; mispositionEngine?: EngineKey; engineOverrides?: Partial<Record<EngineKey, BrandSlot[]>> }
> = {
  p5: { mispositionEngine: "gemini" }, // "best home equity investment company" — Hometap mispositioned on gemini specifically
  p6: {
    // "Top companies that offer home equity sharing agreements" — Hometap is
    // leader on openai/anthropic/perplexity but Claude simply doesn't
    // surface it here, a distinct engine-disagreement beat from p5's
    // mispositioning (this one is a flat omission, not a category mix-up).
    engineOverrides: { anthropic: [{ brand: "Point", positioning: "leader" }, { brand: "Unison", positioning: "alternative" }] },
  },
  p7: { slots: [{ brand: "Hometap", positioning: "leader" }, { brand: "Point", positioning: "alternative" }] }, // the fees prompt — Hometap's strongest showing
  p10: { slots: [{ brand: "Unlock", positioning: "leader" }, { brand: "Point", positioning: "alternative" }] }, // debt payoff — GAP: Hometap absent
  p14: {
    slots: [{ brand: "Point", positioning: "alternative" }, { brand: "Unlock", positioning: "secondary" }], // retiree/fixed income — GAP: Hometap absent
    // ChatGPT alone also surfaces Unison here — a real engine sometimes pulls
    // in one extra name the others don't, without changing the core "Hometap
    // is absent" gap this prompt exists to demonstrate.
    engineOverrides: { openai: [{ brand: "Point", positioning: "alternative" }, { brand: "Unlock", positioning: "secondary" }, { brand: "Unison", positioning: "niche" }] },
  },
};

function sentimentFor(positioning: Positioning): "positive" | "neutral" | "negative" {
  if (positioning === "leader" || positioning === "alternative") return "positive";
  return "neutral";
}

const OWN_DOMAINS: Record<string, string> = {
  Hometap: "hometap.com",
  Point: "point.com",
  Unison: "unison.com",
  Unlock: "unlock.com",
};

// Heavy on personal-finance comparison/review sites — this is the actual
// genre of content that ranks and gets cited for "best HEI company" queries.
// Perplexity gets a guaranteed, heavier rotation; other engines a lighter one.
const REVIEW_DOMAINS = ["trustpilot.com", "bbb.org", "nerdwallet.com", "bankrate.com", "lendedu.com"];
const PRESS_DOMAINS = ["forbes.com", "housingwire.com", "money.com", "themortgagereports.com", "cnbc.com"];

function pickByIndex<T>(arr: readonly T[], i: number): T {
  return arr[i % arr.length];
}

// No `news` field here on purpose — a prior version shipped six invented
// headlines/URLs attributed to real outlets (forbes.com, housingwire.com…)
// as "demo data." Fabricating text and putting a real publication's name on
// it is not an acceptable shortcut for a demo, seeded or not. The Step 4
// news scan calls the live GDELT API in every mode, demo included — see
// lib/newsScan.ts — so there is nothing to seed here.
export type DemoDataset = {
  prompts: { id: string; text: string; theme: string; branded: boolean }[];
  runs: RunRow[];
  mentions: MentionRow[];
  citations: (CitationRow & { engine: string; promptId: string })[];
};

// The final, post-bias-check prompt set (same one shown on the prompt-review
// screen) is the single source of truth for which prompts get simulated here
// — so the mention data always matches what the UI displays.
const { prompts: FINAL_PROMPTS } = buildDemoPromptGeneration();

export function buildDemoDataset(): DemoDataset {
  const allPrompts = FINAL_PROMPTS.map((p) => ({ id: p.id, text: p.text, theme: p.theme, branded: p.branded }));

  const runs: RunRow[] = [];
  const mentions: MentionRow[] = [];
  const citations: (CitationRow & { engine: string; promptId: string })[] = [];

  allPrompts.forEach((prompt, promptIndex) => {
    const override = PROMPT_OVERRIDES[prompt.id];
    const baseSlots: BrandSlot[] = prompt.branded
      ? [] // branded prompts get their brand list computed below, not from the theme template
      : override?.slots ?? THEME_TEMPLATE[prompt.theme as ThemeKey] ?? [];

    for (const engine of ENGINES) {
      runs.push({ promptId: prompt.id, theme: prompt.theme, branded: prompt.branded, engine });

      let slots: BrandSlot[];
      if (prompt.branded) {
        // Branded prompts: Hometap plus whichever competitor(s) the prompt text names, in that order.
        const named = DEMO_BRANDS.filter((b) => prompt.text.includes(b));
        slots = named.map((brand, i) => ({ brand, positioning: i === 0 ? "leader" : ("alternative" as Positioning) }));
        if (!slots.some((s) => s.brand === "Hometap")) slots.unshift({ brand: "Hometap", positioning: "leader" });
      } else {
        slots = override?.engineOverrides?.[engine] ?? baseSlots;
      }

      let ordered = slots.map((slot) => {
        if (slot.brand === "Hometap" && override?.mispositionEngine === engine) {
          return { ...slot, positioning: "mispositioned" as Positioning };
        }
        return slot;
      });

      // Perplexity's whole pitch is broader, fresher retrieval — it's the one
      // engine that reliably surfaces Hometap even where the others treat it
      // as an afterthought. Modeled as a blanket per-theme upgrade rather
      // than another one-off override, since it's a property of the engine,
      // not any single prompt.
      if (engine === "perplexity" && prompt.theme === "Use case") {
        ordered = ordered.map((slot) => (slot.brand === "Hometap" && slot.positioning === "secondary" ? { ...slot, positioning: "alternative" as Positioning } : slot));
      }
      // Same idea, frequency rather than position: Life situation's theme
      // default omits Hometap entirely, but Perplexity still surfaces it as
      // a secondary mention on prompts that don't have their own explicit
      // override — EXCEPT the retiree prompt (p14), which keeps its
      // override precisely so this rule can't touch it and erase the
      // deliberate "Hometap is absent here on every engine" gap.
      if (engine === "perplexity" && prompt.theme === "Life situation" && !override?.slots && !ordered.some((s) => s.brand === "Hometap")) {
        ordered = [...ordered, { brand: "Hometap", positioning: "secondary" as Positioning }];
      }

      ordered.forEach((slot, idx) => {
        // Citation rule: Perplexity cites whatever it mentions (its whole
        // pitch is sourcing); other engines only reliably cite the brand
        // they call the outright leader — everything else is a real
        // mention-without-citation gap, not a coin flip.
        const ownDomainCited = engine === "perplexity" || slot.positioning === "leader";
        mentions.push({
          promptId: prompt.id,
          promptText: prompt.text,
          theme: prompt.theme,
          branded: prompt.branded,
          engine,
          brand: slot.brand,
          isTarget: slot.brand === DEMO_COMPANY.name,
          rank: idx + 1,
          positioning: slot.positioning,
          sentiment: sentimentFor(slot.positioning),
          ownDomainCited,
        });
        if (ownDomainCited) citations.push({ engine, promptId: prompt.id, domain: OWN_DOMAINS[slot.brand] });
      });

      // Third-party citations — deterministic, not probabilistic.
      if (engine === "perplexity") {
        citations.push({ engine, promptId: prompt.id, domain: pickByIndex(REVIEW_DOMAINS, promptIndex) });
        citations.push({ engine, promptId: prompt.id, domain: pickByIndex(REVIEW_DOMAINS, promptIndex + 1) });
        citations.push({ engine, promptId: prompt.id, domain: pickByIndex(PRESS_DOMAINS, promptIndex) });
      } else if (promptIndex % 2 === 0) {
        citations.push({ engine, promptId: prompt.id, domain: pickByIndex(REVIEW_DOMAINS, promptIndex) });
      }
      // Reddit shows up as a real citation on ChatGPT/Perplexity but almost
      // never on Gemini/Claude — mirrors the pattern that platform citation
      // behavior varies a lot even within the same vertical.
      if ((engine === "openai" || engine === "perplexity") && promptIndex % 3 === 0) {
        citations.push({ engine, promptId: prompt.id, domain: "reddit.com" });
      }
    }
  });

  return { prompts: allPrompts, runs, mentions, citations };
}
