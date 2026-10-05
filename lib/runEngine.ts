// Orchestrates a Snapshot: builds the (prompt × engine × mode × sample) task
// list, executes it through a per-engine concurrency-limited queue with
// retry/backoff, judges each successful response, and leaves the run
// complete (or complete_with_errors) with partial results rather than
// crashing on one bad call. Demo mode substitutes seeded fixtures for real
// provider calls but runs through the exact same queue/retry/judge pipeline.
import { prisma } from "./db";
import { ADAPTERS, allEngines } from "./providers";
import type { EngineKey, RunMode } from "./providers/types";
import { runWithConcurrency, withRetry } from "./queue";
import { judgeResponse, type TrackedBrandWithAliases } from "./judge";
import { buildDemoRunFixtures, groundTruthExtraction, demoStagingIdsByOrderIndex, applyDemoMode, DEMO_SIMULATED_FAILURE } from "./demoRunFixtures";
import { checkExtractionConsistency } from "./consistencyCheck";
import { runNewsScan } from "./newsScan";
import type { CompetitorSuggestion } from "./demoCompany";

const CONCURRENCY_PER_ENGINE: Record<EngineKey, number> = {
  openai: 3,
  anthropic: 3,
  gemini: 3,
  perplexity: 3,
  serpapi: 2,
};
const RETRY_OPTS = { retries: 2, baseDelayMs: 400 };

export type RunConfig = {
  engines: EngineKey[];
  samplesPerPrompt: number; // 1-3
  dualMode: boolean;
};

export type CostEstimate = {
  perEngine: { engine: EngineKey; label: string; calls: number; costUsd: number }[];
  totalCalls: number;
  totalCostUsd: number;
};

export async function estimateRun(versionId: string, config: RunConfig): Promise<CostEstimate> {
  const promptCount = await prisma.prompt.count({ where: { promptSetVersionId: versionId } });
  const perEngine = config.engines.map((key) => {
    const adapter = ADAPTERS[key];
    const modes = config.dualMode && adapter.supportsUngroundedMode ? 2 : 1;
    const calls = promptCount * modes * config.samplesPerPrompt;
    return { engine: key, label: adapter.label, calls, costUsd: Math.round(calls * adapter.estCostPerCall * 100) / 100 };
  });
  return {
    perEngine,
    totalCalls: perEngine.reduce((s, e) => s + e.calls, 0),
    totalCostUsd: Math.round(perEngine.reduce((s, e) => s + e.costUsd, 0) * 100) / 100,
  };
}

// Unverified aliases (not traceable to fetched site text, news, or the
// user) are deliberately excluded from brand-detection matching — an
// invented alias could cause false-positive "mentions" that don't exist.
export async function getTrackedBrandsWithAliases(analysisId: string): Promise<TrackedBrandWithAliases[]> {
  const analysis = await prisma.analysis.findUniqueOrThrow({ where: { id: analysisId }, include: { profile: true } });
  if (!analysis.profile) return [{ name: analysis.companyName, aliases: [] }];
  const targetAliases: string[] = analysis.profile.aliasesVerified ? JSON.parse(analysis.profile.aliases) : [];
  const confirmed: { name: string }[] = JSON.parse(analysis.profile.confirmedCompetitors);
  const suggested: CompetitorSuggestion[] = JSON.parse(analysis.profile.suggestedCompetitors);
  const competitors = confirmed.map((c) => {
    const match = suggested.find((s) => s.name === c.name);
    return { name: c.name, aliases: match?.aliasesVerified ? match.aliases : [] };
  });
  return [{ name: analysis.companyName, aliases: targetAliases }, ...competitors];
}

export async function startRun(analysisId: string, config: RunConfig): Promise<string> {
  const analysis = await prisma.analysis.findUniqueOrThrow({
    where: { id: analysisId },
    include: { promptSet: { include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } } }, snapshots: true },
  });
  const version = analysis.promptSet?.versions[0];
  if (!version) throw new Error("No prompt set version to run");
  if (!version.locked) throw new Error("Runs can only execute against a locked prompt set version");

  const estimate = await estimateRun(version.id, config);
  const snapshot = await prisma.snapshot.create({
    data: {
      analysisId,
      promptSetVersionId: version.id,
      runNumber: analysis.snapshots.length + 1,
      status: "running",
      engines: JSON.stringify(config.engines),
      samplesPerPrompt: config.samplesPerPrompt,
      dualMode: config.dualMode,
      estimatedCost: estimate.totalCostUsd,
    },
  });

  await prisma.analysis.update({ where: { id: analysisId }, data: { status: "running" } });

  // Fire-and-forget: this Next.js dev server is a single long-running Node
  // process, so the promise keeps executing after the triggering request
  // returns. (A serverless deployment would need a real background-job
  // mechanism instead — out of scope for this prototype.)
  executeRun(snapshot.id).catch(async (err) => {
    await prisma.snapshot.update({
      where: { id: snapshot.id },
      data: { status: "failed", errorMessage: err instanceof Error ? err.message : String(err), completedAt: new Date() },
    });
  });

  return snapshot.id;
}

type Task = {
  promptId: string;
  demoStagingId?: string; // bridges DB Prompt.id -> demo fixture's generation-time staging id, via orderIndex
  promptText: string;
  branded: boolean;
  engine: EngineKey;
  mode: RunMode;
  sampleIndex: number;
};

export async function executeRun(snapshotId: string): Promise<void> {
  const snapshot = await prisma.snapshot.findUniqueOrThrow({
    where: { id: snapshotId },
    include: { analysis: true, promptSetVersion: { include: { prompts: true } } },
  });
  const engines: EngineKey[] = JSON.parse(snapshot.engines);
  const isDemo = snapshot.analysis.isDemo;

  const stagingIds = isDemo ? demoStagingIdsByOrderIndex() : null;

  const tasks: Task[] = [];
  for (const prompt of snapshot.promptSetVersion.prompts) {
    for (const engine of engines) {
      const adapter = ADAPTERS[engine];
      const modes: RunMode[] = snapshot.dualMode && adapter.supportsUngroundedMode ? ["grounded", "ungrounded"] : ["grounded"];
      for (const mode of modes) {
        for (let sampleIndex = 0; sampleIndex < snapshot.samplesPerPrompt; sampleIndex++) {
          tasks.push({
            promptId: prompt.id,
            demoStagingId: stagingIds?.[prompt.orderIndex],
            promptText: prompt.text,
            branded: prompt.branded,
            engine,
            mode,
            sampleIndex,
          });
        }
      }
    }
  }

  const demoFixtures = isDemo ? buildDemoRunFixtures() : null;
  const trackedBrands = isDemo ? [] : await getTrackedBrandsWithAliases(snapshot.analysisId); // demo path uses ground truth directly, doesn't need this

  const byEngine = new Map<EngineKey, Task[]>();
  for (const t of tasks) {
    if (!byEngine.has(t.engine)) byEngine.set(t.engine, []);
    byEngine.get(t.engine)!.push(t);
  }

  await Promise.all(
    [...byEngine.entries()].map(([engine, engineTasks]) =>
      runWithConcurrency(engineTasks, CONCURRENCY_PER_ENGINE[engine] ?? 2, (task) => runOneTask(snapshot, task, isDemo, demoFixtures, trackedBrands))
    )
  );

  // News scan runs after the AI-visibility responses are in, using the same
  // confirmed-competitor list — a failure here (rate limit, no adapter
  // reachable) degrades to an empty news list rather than failing the whole
  // snapshot, since the AI-visibility results are already safely stored.
  try {
    await runNewsScan(snapshotId);
  } catch (err) {
    console.error("News scan failed:", err);
  }

  const responses = await prisma.providerResponse.findMany({ where: { snapshotId }, select: { status: true, costUsd: true } });
  const anyError = responses.some((r) => r.status === "error");
  await prisma.snapshot.update({
    where: { id: snapshotId },
    data: {
      status: anyError ? "complete_with_errors" : "complete",
      completedAt: new Date(),
      callCount: responses.length,
      actualCost: Math.round(responses.reduce((s, r) => s + (r.costUsd ?? 0), 0) * 100) / 100,
    },
  });
  await prisma.analysis.update({ where: { id: snapshot.analysisId }, data: { status: "complete" } });
}

async function runOneTask(
  snapshot: { id: string; analysisId: string; createdAt: Date },
  task: Task,
  isDemo: boolean,
  demoFixtures: ReturnType<typeof buildDemoRunFixtures> | null,
  trackedBrands: TrackedBrandWithAliases[]
): Promise<void> {
  // Cache: an earlier response for the same prompt/engine/mode/sample, on the
  // same calendar day, is reused instead of re-calling the provider.
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const cached = await prisma.providerResponse.findFirst({
    where: {
      promptId: task.promptId,
      engine: task.engine,
      mode: task.mode,
      sampleIndex: task.sampleIndex,
      status: "ok",
      timestamp: { gte: todayStart },
    },
    orderBy: { timestamp: "desc" },
  });

  if (cached) {
    const created = await prisma.providerResponse.create({
      data: {
        promptId: task.promptId,
        snapshotId: snapshot.id,
        engine: task.engine,
        mode: task.mode,
        sampleIndex: task.sampleIndex,
        model: cached.model,
        status: "ok",
        fullText: cached.fullText,
        citations: cached.citations,
        costUsd: 0,
        latencyMs: 0,
        cachedFrom: cached.id,
      },
    });
    await runJudgeForResponse(created.id, task, isDemo, demoFixtures, trackedBrands);
    return;
  }

  const started = Date.now();
  const attempt = () => callEngineOrDemo(task, isDemo, demoFixtures);
  const outcome = await withRetry(attempt, RETRY_OPTS);
  const latencyMs = Date.now() - started;

  const created = await prisma.providerResponse.create({
    data:
      "result" in outcome
        ? {
            promptId: task.promptId,
            snapshotId: snapshot.id,
            engine: task.engine,
            mode: task.mode,
            sampleIndex: task.sampleIndex,
            model: outcome.result.model,
            status: "ok",
            fullText: outcome.result.fullText,
            citations: JSON.stringify(outcome.result.citations ?? []),
            costUsd: outcome.result.costUsd ?? 0,
            latencyMs,
            retryCount: outcome.retryCount,
          }
        : {
            promptId: task.promptId,
            snapshotId: snapshot.id,
            engine: task.engine,
            mode: task.mode,
            sampleIndex: task.sampleIndex,
            model: task.engine,
            status: "error",
            errorMessage: outcome.error.message,
            latencyMs,
            retryCount: outcome.retryCount,
          },
  });

  if ("result" in outcome) {
    await runJudgeForResponse(created.id, task, isDemo, demoFixtures, trackedBrands);
  }
}

async function callEngineOrDemo(
  task: Task,
  isDemo: boolean,
  demoFixtures: ReturnType<typeof buildDemoRunFixtures> | null
): Promise<{ model: string; fullText: string; citations: { url: string | null; domain: string }[]; costUsd: number }> {
  if (isDemo) {
    // Deterministic simulated failure so retry/backoff/partial-results is
    // genuinely exercised, not just claimed to work.
    if (task.demoStagingId === DEMO_SIMULATED_FAILURE.promptId && task.engine === DEMO_SIMULATED_FAILURE.engine) {
      throw new Error("Simulated provider timeout (demo mode failure test)");
    }
    const baseFixture = demoFixtures!.get(`${task.demoStagingId}::${task.engine}`);
    // A tiny per-sample variation so repeated samples don't look
    // byte-identical, echoing the "answers vary" requirement even in demo.
    const variationSuffix = task.sampleIndex > 0 ? ` (sample ${task.sampleIndex + 1} — wording varies slightly run to run.)` : "";
    if (!baseFixture) {
      // A prompt added/edited after the demo dataset was seeded has no
      // pre-built fixture — degrade gracefully (a live run would just call
      // the real engine) rather than failing every engine for it.
      return {
        model: `demo-${task.engine}`,
        fullText: "This prompt was added after the demo's seeded dataset was built, so demo mode has no simulated brand-mention data for it — a live run would produce a real answer here.",
        citations: [],
        costUsd: 0,
      };
    }
    // applyDemoMode weakens Hometap's presence for ungrounded mode and
    // regenerates the text to match — the SAME transformed fixture is used
    // again in runJudgeForResponse below, so the stored extraction always
    // matches whatever text actually got stored, in either mode.
    const fixture = applyDemoMode(baseFixture, task.mode);
    return {
      model: `demo-${task.engine}`,
      fullText: fixture.rawText + variationSuffix,
      citations: fixture.citations,
      costUsd: 0,
    };
  }

  const adapter = ADAPTERS[task.engine];
  const result = await adapter.run(task.promptText, { mode: task.mode });
  if (result.status === "error") throw new Error(result.errorMessage ?? "engine call failed");
  return { model: result.model, fullText: result.fullText ?? "", citations: result.citations ?? [], costUsd: result.costUsd ?? 0 };
}

async function runJudgeForResponse(
  responseId: string,
  task: Task,
  isDemo: boolean,
  demoFixtures: ReturnType<typeof buildDemoRunFixtures> | null,
  trackedBrands: TrackedBrandWithAliases[]
): Promise<void> {
  const response = await prisma.providerResponse.findUniqueOrThrow({ where: { id: responseId } });
  const citations: { url: string | null; domain: string }[] = response.citations ? JSON.parse(response.citations) : [];

  // Demo mode ALWAYS stores ground truth as the canonical extraction — it's
  // constructed directly from the same mentions the raw text was rendered
  // from, so it's self-consistent by definition. A real Groq judge run
  // against demo fixtures is a genuinely useful reliability check (does the
  // judge agree with the known-correct answer?), but that's a *comparison
  // report* (scripts/judge-agreement-report.ts), never a substitute for the
  // displayed/stored data — swapping it in here is what caused demo
  // extractions to visibly contradict their own raw text.
  if (isDemo) {
    const baseFixture = demoFixtures!.get(`${task.demoStagingId}::${task.engine}`);
    const fixture = baseFixture ? applyDemoMode(baseFixture, task.mode) : undefined;
    const extraction = fixture ? groundTruthExtraction(fixture.mentions) : { brandMentions: [], otherBrandsMentioned: [] };
    const brandMentions = extraction.brandMentions.map((b, i) => ({ ...b, isTarget: fixture?.mentions[i]?.isTarget ?? false }));
    const demoTrackedBrands = fixture ? [...new Set(fixture.mentions.map((m) => m.brand))].map((name) => ({ name, aliases: [] as string[] })) : [];
    const issues = checkExtractionConsistency(response.fullText ?? "", brandMentions.map((b) => b.brand), demoTrackedBrands);
    await prisma.extractedAnalysis.create({
      data: {
        responseId,
        brandMentions: JSON.stringify(brandMentions),
        otherBrandsMentioned: JSON.stringify(extraction.otherBrandsMentioned),
        judgeModel: null,
        judgeSource: "heuristic",
        wasRetried: false,
        flaggedForReview: issues.length > 0,
        consistencyIssues: issues.length > 0 ? JSON.stringify(issues) : null,
      },
    });
    return;
  }

  const result = await judgeResponse({ responseText: response.fullText ?? "", citations, trackedBrands });
  const brandMentions = result.extraction.brandMentions.map((b) => ({ ...b, isTarget: b.brand === trackedBrands[0]?.name }));
  const issues = checkExtractionConsistency(response.fullText ?? "", brandMentions.map((b) => b.brand), trackedBrands);
  await prisma.extractedAnalysis.create({
    data: {
      responseId,
      brandMentions: JSON.stringify(brandMentions),
      otherBrandsMentioned: JSON.stringify(result.extraction.otherBrandsMentioned),
      judgeModel: result.judgeModel,
      judgeSource: result.judgeSource,
      wasRetried: result.wasRetried,
      flaggedForReview: result.flaggedForReview || issues.length > 0,
      consistencyIssues: issues.length > 0 ? JSON.stringify(issues) : null,
    },
  });
}

export async function getRunProgress(snapshotId: string) {
  const snapshot = await prisma.snapshot.findUniqueOrThrow({ where: { id: snapshotId } });
  const total = await prisma.prompt.count({ where: { promptSetVersionId: snapshot.promptSetVersionId } }).then(async (promptCount) => {
    const engines: EngineKey[] = JSON.parse(snapshot.engines);
    let modesTotal = 0;
    for (const e of engines) modesTotal += snapshot.dualMode && ADAPTERS[e].supportsUngroundedMode ? 2 : 1;
    return promptCount * modesTotal * snapshot.samplesPerPrompt;
  });
  const [ok, error] = await Promise.all([
    prisma.providerResponse.count({ where: { snapshotId, status: "ok" } }),
    prisma.providerResponse.count({ where: { snapshotId, status: "error" } }),
  ]);
  return { status: snapshot.status, total, ok, error, done: ok + error };
}

export async function getSnapshotResponses(snapshotId: string) {
  return prisma.providerResponse.findMany({
    where: { snapshotId },
    include: { prompt: true, extraction: true },
    orderBy: [{ prompt: { orderIndex: "asc" } }, { engine: "asc" }, { sampleIndex: "asc" }],
  });
}

export async function getResponseDetail(responseId: string) {
  return prisma.providerResponse.findUnique({ where: { id: responseId }, include: { prompt: true, extraction: true } });
}

// A human review can override the judge's brandMentions — stored separately
// (correctedBrandMentions) so the judge's original output is never
// destructively overwritten; metrics should read the correction when present.
export async function correctExtraction(
  responseId: string,
  correctedBrandMentions: unknown,
  correctedBy?: string
): Promise<void> {
  const response = await prisma.providerResponse.findUniqueOrThrow({ where: { id: responseId }, include: { extraction: true } });
  if (!response.extraction) throw new Error("No extraction to correct");
  await prisma.extractedAnalysis.update({
    where: { id: response.extraction.id },
    data: {
      correctedBrandMentions: JSON.stringify(correctedBrandMentions),
      correctedBy: correctedBy ?? "agency user",
      correctedAt: new Date(),
    },
  });
}

export { allEngines };
