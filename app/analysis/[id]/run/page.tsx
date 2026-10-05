import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { getLatestPromptSetVersion } from "@/lib/analysisPipeline";
import { estimateRun, type RunConfig } from "@/lib/runEngine";
import { allEngines } from "@/lib/providers";
import type { EngineKey } from "@/lib/providers/types";
import { DemoBanner } from "@/components/DemoBanner";
import { StepIndicator } from "@/components/StepIndicator";
import { previewRunAction, startRunAction } from "../../actions";

const DEMO_ENGINE_KEYS = ["openai", "anthropic", "gemini", "perplexity"];

export default async function RunConfigPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ engines?: string; samples?: string; dual?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const analysis = await prisma.analysis.findUnique({ where: { id } });
  if (!analysis) return notFound();

  const version = await getLatestPromptSetVersion(id);

  if (!version || !version.locked) {
    return (
      <div className="min-h-screen bg-neutral-50">
        {analysis.isDemo && <DemoBanner />}
        <div className="mx-auto max-w-2xl px-6 py-10">
          <StepIndicator current="Run" />
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-5 text-sm text-amber-900">
            Runs can only execute against a <strong>locked</strong> prompt set version.{" "}
            <Link href={`/analysis/${id}/prompts`} className="font-semibold underline">
              Go lock the prompt set →
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const engineOptions = analysis.isDemo ? allEngines().filter((e) => DEMO_ENGINE_KEYS.includes(e.key)) : allEngines();
  const preview: RunConfig | null = sp.engines
    ? {
        engines: sp.engines.split(",").filter(Boolean) as EngineKey[],
        samplesPerPrompt: Number(sp.samples ?? "1"),
        dualMode: sp.dual === "1",
      }
    : null;
  const estimate = preview ? await estimateRun(version.id, preview) : null;

  return (
    <div className="min-h-screen bg-neutral-50">
      {analysis.isDemo && <DemoBanner />}
      <div className="mx-auto max-w-2xl px-6 py-10">
        <Link href={`/analysis/${id}/prompts`} className="text-sm text-neutral-500 hover:underline">
          ← Back to prompts
        </Link>
        <header className="mt-2 mb-4">
          <StepIndicator current="Run" />
          <h1 className="text-2xl font-bold text-neutral-900">{analysis.companyName}</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Running against prompt set v{version.versionNumber} (locked, {version.prompts.length} prompts).
          </p>
        </header>

        {!estimate ? (
          <form action={previewRunAction.bind(null, id)} className="space-y-5 rounded-lg border border-neutral-200 bg-white p-5">
            <fieldset>
              <legend className="mb-2 text-xs font-bold uppercase tracking-wide text-neutral-500">Engines</legend>
              <div className="space-y-2">
                {engineOptions.map((e) => (
                  <label key={e.key} className={`flex items-center gap-2 text-sm ${!analysis.isDemo && !e.isConfigured() ? "text-neutral-400" : "text-neutral-800"}`}>
                    <input
                      type="checkbox"
                      name="engines"
                      value={e.key}
                      defaultChecked={analysis.isDemo ? DEMO_ENGINE_KEYS.includes(e.key) : e.isConfigured()}
                      disabled={!analysis.isDemo && !e.isConfigured()}
                    />
                    {e.label}
                    {!analysis.isDemo && !e.isConfigured() && <span className="text-xs">(no key configured)</span>}
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Samples per prompt — answers vary between runs of the same prompt
              </span>
              <select name="samples" defaultValue="1" className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm">
                <option value="1">1 (default)</option>
                <option value="2">2</option>
                <option value="3">3</option>
              </select>
            </label>

            <label className="flex items-center gap-2 text-sm text-neutral-800">
              <input type="checkbox" name="dual" value="1" />
              Run grounded + ungrounded (web search on/off) for engines that support both
            </label>

            <button className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
              Preview cost →
            </button>
          </form>
        ) : (
          <div className="space-y-5">
            <div className="rounded-lg border border-neutral-200 bg-white p-5">
              <h2 className="mb-3 font-mono text-xs uppercase tracking-wide text-neutral-500">Estimated cost</h2>
              <table className="w-full text-sm">
                <tbody>
                  {estimate.perEngine.map((e) => (
                    <tr key={e.engine} className="border-b border-neutral-100">
                      <td className="py-1.5 text-neutral-700">{e.label}</td>
                      <td className="py-1.5 text-right text-neutral-500">{e.calls} calls</td>
                      <td className="py-1.5 text-right font-mono text-neutral-900">${e.costUsd.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-3 flex justify-between border-t border-neutral-200 pt-3 text-sm font-bold text-neutral-900">
                <span>{estimate.totalCalls} total calls</span>
                <span>${estimate.totalCostUsd.toFixed(2)} estimated</span>
              </div>
              {analysis.isDemo && (
                <p className="mt-2 text-xs text-neutral-500">
                  Demo mode makes no real API calls — this is what the estimate would look like for a live run at this
                  configuration.
                </p>
              )}
            </div>

            <div className="flex gap-2">
              <form action={startRunAction.bind(null, id, preview!)}>
                <button className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
                  Confirm &amp; start run →
                </button>
              </form>
              <Link
                href={`/analysis/${id}/run`}
                className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50"
              >
                Change configuration
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
