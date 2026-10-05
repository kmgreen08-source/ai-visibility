# Live testing notes

How this app's LLM layer actually runs, in two modes: **Groq (free tier)**, which
is where it stands today, and a **future paid-model mode** once real keys for
the measured engines (and optionally a paid reasoning model) are added.

## The two kinds of "AI" in this app — don't conflate them

1. **Measured AI-visibility engines** — ChatGPT (OpenAI), Claude (Anthropic),
   Gemini (Google), Perplexity, optionally SerpAPI/Google AI Overview. These
   are what the product measures. Until their own keys are added to
   `.env.local`, every run against them uses seeded **demo data** — never a
   substitute model standing in for them.
2. **The reasoning workhorse (Groq)** — powers internal tasks: company
   profile, competitor suggestions, prompt generation, bias-check rewrites,
   the LLM-as-judge extraction, and (Step 4) news relevance/sentiment
   classification. **Groq is never used as a measured engine.** It doesn't
   appear in the run-configuration engine list, and `lib/providers/index.ts`
   deliberately excludes it from `ADAPTERS`. Presenting Groq's own output as
   if it were a ChatGPT/Gemini/etc. answer would misrepresent what the
   visibility data means — a buyer never actually asks Groq's open-weight
   model when they open ChatGPT.

## Current mode: Groq free tier

- Add a Groq key at **console.groq.com → API Keys** and put it in
  `GROQ_API_KEY` in `.env.local`. `.env.local` is gitignored (`.env*` in
  `.gitignore`) — never commit it.
- Default model: `openai/gpt-oss-120b` (heavier tasks) and
  `openai/gpt-oss-20b` (the two high-volume news-classification tasks).
  **Not a Llama model** — Llama 3.1/3.3 moved to Groq's enterprise-only
  pricing tier at some point before this was built, so GPT-OSS is the actual
  "strong open model" available on the free/developer tier today. Verify
  current pricing/tier status at console.groq.com/docs/models before
  assuming this hasn't changed again.
- **Per-task model config lives in Settings** (`/settings`), not code —
  `lib/reasoningModel.ts`'s `DEFAULT_TASK_MODELS` is only the fallback when a
  task has no override saved. Changing a task's provider/model there takes
  effect on the next request, no redeploy.
- **Concurrency**: capped at 2 concurrent Groq calls by default
  (`Settings.groqConcurrency`), independent of the measured-engine run
  queue — because this Groq account also powers a live chatbot on
  kevingreen.io and free-tier rate limits are shared across the account.
- **429 handling**: a rate-limited call backs off (honoring `Retry-After`
  when Groq sends it, exponential otherwise) and retries up to 3 times
  before falling through to the schema-validation retry path. It does not
  hard-fail on a single 429.
- **Caching**: every reasoning-task result is cached by
  (task, provider, model, content-hash) in the `ReasoningCache` table.
  Re-running the same profile/prompt-generation/judge call on the same
  inputs never re-hits the API.
- **No web search**: none of these tasks have live web access. The profile
  step's UI carries an explicit "Generated from model knowledge — verify"
  disclaimer, and the schema instructs the model to return `null` rather
  than invent a competitor URL it isn't confident about (confirmed live —
  see "What the live test found" below).
- **Reliability**: structured output via `generateObject`, validated against
  a Zod schema. On failure, one retry with the validation error fed back
  into the prompt; if that also fails, falls back to a heuristic
  (mechanical, no-LLM) result and marks it `flaggedForReview: true`.
- **Source tags**: every profile field, competitor suggestion, generated
  prompt, bias-check rewrite, and judge extraction is tagged `groq`,
  `heuristic`, or `manual` (`ExtractedAnalysis.judgeSource`,
  `Prompt.source`, `BiasCheckRecord.rewriteSource`,
  `CompanyProfile.profileSource`/`competitorsSource`) and shown as a small
  badge in the UI — see `components/SourceBadge.tsx`.

### Running the live test scripts

```bash
# Loads .env.local manually since a raw tsx script doesn't auto-load it the
# way Next.js does — this is why `source .env.local` matters here.
cd ai-visibility-pitch
set -a && source .env.local && set +a
npx tsx scripts/test-groq-live.ts   # profile + competitors + prompt-gen + bias-check, against a real "Hometap" analysis
npx tsx scripts/test-groq-judge.ts  # real judge vs. ground truth on a handful of demo fixtures
npx tsx scripts/smoke-demo.ts       # demo dataset sanity check, no key needed
```

### What the live test found (2026-09-28)

- **A real bug, caught and fixed**: Groq's structured-output mode enforces
  OpenAI's strict JSON-schema rule that *every* property must be listed in
  `required` — a Zod field with `.default([])` or `.optional()` doesn't
  satisfy that, and Groq rejects the whole schema with a 400. This broke
  profile and competitor-suggestion generation silently (both fell back to
  heuristic) until `aliases` lost its `.default([])` and `url` became
  `.nullable()` instead of `.optional()`. Worth remembering for any future
  schema added to a Groq-routed task.
- **Profile generation**: accurate, reasonable output for a real company —
  description, category, ICP, and capabilities all correctly characterized
  Hometap's actual business.
- **Competitor suggestions**: named real, correct direct competitors
  (Unison, Point) and a sensible indirect one (SoFi, correctly reasoned as
  "different financing structure"). One suggested competitor's URL came
  back `null` rather than a guessed domain — the "never invent a URL"
  instruction held up under an actual test, not just in the prompt text.
- **Prompt generation**: 25 prompts, cleanly separated unbranded/branded,
  in plain buyer language. Zero bias-check catches on this run — a
  legitimate result (no brand leaks, no jargon-list matches), not a failure
  of the checker; the mechanism was already separately verified with
  deliberately-flawed input in demo mode.
- **Judge**: mechanically solid — brand identification, mention rank, and
  citation detection matched ground truth closely across every sample.
  Positioning and sentiment calibration diverge more often than the other
  fields — e.g. the deliberately-seeded "mispositioned" demo case (Hometap
  described as a reverse-mortgage provider) came back as `"alternative"` or
  `"secondary"` from the real judge rather than `"mispositioned"`. This
  isn't necessarily the judge being wrong (the demo's "ground truth" is
  itself just a simulated label, not a verified correct answer) — it's the
  real reason the human-correction workflow in the review screen exists,
  and it's worth watching for a systematic pattern (the judge reading as
  more generous than warranted on ambiguous mischaracterization) once real
  engine data is flowing.

## Future mode: paid models added

When OpenAI/Anthropic/Gemini/Perplexity keys are added, the measured-engine
run flow activates automatically (`configuredEngines()` in
`lib/providers/index.ts` already reflects whichever keys exist) — no code
change. Two independent decisions from there:

- **Measured engines**: pick which of the newly-configured engines to
  include on the run-configuration screen, same as today.
- **Reasoning tasks**: still default to Groq. To move a task (e.g. `judge`)
  to a paid model instead, change its provider/model in `/settings` — no
  code change, since `lib/reasoningModel.ts` resolves provider/model from
  Settings at call time. A reasonable order to consider once paid keys
  exist: move `judge` first (most reasoning-sensitive), keep the
  high-volume news-classification tasks on Groq's free tier.
