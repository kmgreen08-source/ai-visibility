// The single entry point every "workhorse" LLM task goes through: company
// profile, competitor suggestions, prompt generation, bias-check rewrites,
// the LLM-as-judge, and (Step 4) news relevance/sentiment classification.
// Deliberately NOT used for the measured AI-visibility engines — those stay
// on their own adapters in lib/providers/*, on purpose, since a buyer never
// actually asks Groq's open-weight model when they open ChatGPT.
//
// This module is what makes the provider swappable "from settings, not
// code": every task looks up its provider+model from the Settings row
// (falling back to the DEFAULT_TASK_MODELS below), so pointing "judge" at
// Claude later is a database edit, not a redeploy.
import { createGroq } from "@ai-sdk/groq";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { generateObject, type LanguageModel } from "ai";
import { createHash } from "crypto";
import { z } from "zod";
import { prisma } from "./db";

export type ReasoningProvider = "groq" | "openai" | "anthropic";
export type ReasoningSource = ReasoningProvider | "heuristic";

export type TaskName =
  | "profile"
  | "competitorSuggestions"
  | "promptGeneration"
  | "biasCheck"
  | "judge"
  | "newsRelevance";

// Free-tier reality check (verified against Groq's docs, not assumed): Llama
// 3.1/3.3 moved to enterprise-only pricing, so the actual "strong open model
// on the free/developer tier" today is OpenAI's own open-weight GPT-OSS line
// hosted on Groq — not a Llama model, despite the brief asking for one.
// 120B for tasks that need real judgment; 20B (faster, cheaper, still
// capable) for the high-volume, simpler classification task.
// "newsRelevance" covers mention-type + sentiment + topic in one call (see
// lib/newsScan.ts) — a prior version split this into two separate calls
// (relevance, then sentiment), which doubled Groq traffic for no benefit.
const DEFAULT_TASK_MODELS: Record<TaskName, { provider: ReasoningProvider; model: string }> = {
  profile: { provider: "groq", model: "openai/gpt-oss-120b" },
  competitorSuggestions: { provider: "groq", model: "openai/gpt-oss-120b" },
  promptGeneration: { provider: "groq", model: "openai/gpt-oss-120b" },
  biasCheck: { provider: "groq", model: "openai/gpt-oss-120b" },
  judge: { provider: "groq", model: "openai/gpt-oss-120b" },
  newsRelevance: { provider: "groq", model: "openai/gpt-oss-20b" },
};

let settingsCache: { taskModels: Record<string, { provider: ReasoningProvider; model: string }>; groqConcurrency: number } | null = null;

async function loadSettings() {
  if (settingsCache) return settingsCache;
  const row = await prisma.settings.upsert({ where: { id: "default" }, create: {}, update: {} });
  settingsCache = {
    taskModels: JSON.parse(row.taskModels || "{}"),
    groqConcurrency: row.groqConcurrency,
  };
  return settingsCache;
}

// Call after writing to Settings so the next task pickup reflects the change
// without needing a process restart.
export function invalidateSettingsCache() {
  settingsCache = null;
}

export async function getTaskConfig(task: TaskName): Promise<{ provider: ReasoningProvider; model: string }> {
  const settings = await loadSettings();
  return settings.taskModels[task] ?? DEFAULT_TASK_MODELS[task];
}

export async function getAllTaskConfigs(): Promise<Record<TaskName, { provider: ReasoningProvider; model: string }>> {
  const settings = await loadSettings();
  const out = {} as Record<TaskName, { provider: ReasoningProvider; model: string }>;
  for (const task of Object.keys(DEFAULT_TASK_MODELS) as TaskName[]) {
    out[task] = settings.taskModels[task] ?? DEFAULT_TASK_MODELS[task];
  }
  return out;
}

export async function setTaskConfig(task: TaskName, config: { provider: ReasoningProvider; model: string }): Promise<void> {
  const current = await getAllTaskConfigs();
  current[task] = config;
  await prisma.settings.upsert({
    where: { id: "default" },
    create: { taskModels: JSON.stringify(current) },
    update: { taskModels: JSON.stringify(current) },
  });
  invalidateSettingsCache();
}

// Exported for the rare caller that needs to branch on "is there actually a
// live model behind this task" before deciding between two different
// fallback strategies (e.g. demo mode's judge: ground truth vs. a generic
// empty extraction) — runReasoningTask handles the common case internally.
export async function isTaskConfigured(task: TaskName): Promise<boolean> {
  const { provider } = await getTaskConfig(task);
  return isProviderConfigured(provider);
}

function isProviderConfigured(provider: ReasoningProvider): boolean {
  if (provider === "groq") return Boolean(process.env.GROQ_API_KEY);
  if (provider === "openai") return Boolean(process.env.OPENAI_API_KEY);
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// For UI gates that need a quick sync check — e.g. "can a real (non-demo)
// analysis even be started" — without needing to know which specific task
// or provider. Distinct from the measured-engine adapters in lib/providers:
// this is about the workhorse reasoning model (profile/competitors/prompts/
// judge/news), which only ever needs ONE of these three keys.
export function hasAnyReasoningProviderConfigured(): boolean {
  return Boolean(process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY);
}

function resolveModel(provider: ReasoningProvider, model: string): LanguageModel {
  if (provider === "groq") return createGroq({ apiKey: process.env.GROQ_API_KEY })(model);
  if (provider === "openai") return createOpenAI({ apiKey: process.env.OPENAI_API_KEY })(model);
  return createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })(model);
}

// ---------------- Groq concurrency gate ----------------
// Groq's free tier is shared with the personal-site chatbot, so calls here
// are deliberately throttled independent of the measured-engine run queue.
let activeGroqCalls = 0;
const groqWaiters: (() => void)[] = [];

async function acquireGroqSlot(limit: number): Promise<() => void> {
  if (activeGroqCalls < limit) {
    activeGroqCalls++;
    return release;
  }
  return new Promise((resolve) => groqWaiters.push(() => resolve(release)));

  function release() {
    activeGroqCalls--;
    const next = groqWaiters.shift();
    if (next) {
      activeGroqCalls++;
      next();
    }
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// Vercel AI SDK surfaces provider HTTP errors with statusCode/responseHeaders
// on the error object (APICallError) — duck-typed here rather than imported
// so this works across SDK versions without a hard dependency on the class.
function extractHttpError(err: unknown): { statusCode?: number; retryAfterMs?: number } {
  const e = err as { statusCode?: number; responseHeaders?: Record<string, string> } | null;
  const statusCode = e?.statusCode;
  const retryAfterHeader = e?.responseHeaders?.["retry-after"];
  const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : undefined;
  return { statusCode, retryAfterMs };
}

function hashInput(task: string, provider: string, model: string, prompt: string, system?: string): string {
  return createHash("sha256").update(`${task}::${provider}::${model}::${system ?? ""}::${prompt}`).digest("hex");
}

export type ReasoningResult<T> = {
  value: T;
  source: ReasoningSource;
  modelName: string | null;
  cached: boolean;
  wasRetried: boolean;
  flaggedForReview: boolean;
  rateLimited: boolean; // true if a 429 was hit and resolved via backoff — surfaced so the UI can say "rate limited — resuming" instead of pretending nothing happened
};

// The one function every workhorse task calls. Order of operations:
// 1. Look up the task's configured provider/model (settings, not code).
// 2. Check the cache (content-hash keyed) — skip the call entirely on a hit.
// 3. If the provider isn't configured (no key) or every attempt fails
//    (including through 429 backoff), fall back to the caller's heuristic
//    and return flaggedForReview: true.
// 4. On success, cache the result and return it tagged with its real source.
export async function runReasoningTask<T>(opts: {
  task: TaskName;
  prompt: string;
  schema: z.ZodType<T>;
  system?: string;
  heuristicFallback: () => T;
}): Promise<ReasoningResult<T>> {
  const { provider, model } = await getTaskConfig(opts.task);
  const settings = await loadSettings();
  const cacheKey = hashInput(opts.task, provider, model, opts.prompt, opts.system);

  const cached = await prisma.reasoningCache.findUnique({
    where: { task_provider_model_inputHash: { task: opts.task, provider, model, inputHash: cacheKey } },
  });
  if (cached) {
    return { value: JSON.parse(cached.output), source: provider, modelName: model, cached: true, wasRetried: false, flaggedForReview: false, rateLimited: false };
  }

  if (!isProviderConfigured(provider)) {
    return { value: opts.heuristicFallback(), source: "heuristic", modelName: null, cached: false, wasRetried: false, flaggedForReview: true, rateLimited: false };
  }

  const release = provider === "groq" ? await acquireGroqSlot(settings.groqConcurrency) : () => {};
  let rateLimited = false;
  try {
    let lastValidationError: string | null = null;
    // Two attempts total for schema-validation failures; 429s get their own
    // backoff-and-retry loop inside each attempt and don't consume one of
    // these two.
    for (let attempt = 0; attempt < 2; attempt++) {
      const promptForAttempt =
        lastValidationError == null
          ? opts.prompt
          : `${opts.prompt}\n\nYour previous response failed validation with this error — fix it and try again:\n${lastValidationError}`;

      for (let rateLimitAttempt = 0; rateLimitAttempt <= 3; rateLimitAttempt++) {
        try {
          const { object } = await generateObject({
            model: resolveModel(provider, model),
            system: opts.system,
            prompt: promptForAttempt,
            schema: opts.schema,
          });
          await prisma.reasoningCache.create({
            data: { task: opts.task, provider, model, inputHash: cacheKey, output: JSON.stringify(object) },
          });
          return { value: object, source: provider, modelName: model, cached: false, wasRetried: attempt > 0, flaggedForReview: false, rateLimited };
        } catch (err) {
          const { statusCode, retryAfterMs } = extractHttpError(err);
          if (statusCode === 429 && rateLimitAttempt < 3) {
            rateLimited = true;
            await sleep(retryAfterMs ?? 1500 * Math.pow(2, rateLimitAttempt));
            continue;
          }
          lastValidationError = err instanceof Error ? err.message : String(err);
          break; // move to the next validation-retry attempt
        }
      }
    }
    // Falling back silently here previously made real failures (a bad
    // schema, an expired key, a persistent 5xx) indistinguishable from "no
    // key configured" in the UI — log it so a stuck-on-heuristic task is
    // diagnosable instead of just looking like a quietly-degraded demo.
    console.error(`[reasoningModel] task "${opts.task}" fell back to heuristic after 2 attempts:`, lastValidationError);
    return { value: opts.heuristicFallback(), source: "heuristic", modelName: model, cached: false, wasRetried: true, flaggedForReview: true, rateLimited };
  } finally {
    release();
  }
}
