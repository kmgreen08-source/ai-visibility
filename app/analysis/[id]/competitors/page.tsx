import { notFound } from "next/navigation";
import Link from "next/link";
import { getAnalysisWithProfile } from "@/lib/analysisPipeline";
import { DemoBanner } from "@/components/DemoBanner";
import { StepIndicator } from "@/components/StepIndicator";
import { SourceBadge } from "@/components/SourceBadge";
import { confirmCompetitorsAction, addCustomCompetitorAction } from "../../actions";
import type { CompetitorSuggestion } from "@/lib/demoCompany";

const CONFIDENCE_STYLE: Record<string, string> = {
  high: "bg-emerald-100 text-emerald-800",
  medium: "bg-amber-100 text-amber-800",
  low: "bg-neutral-200 text-neutral-700",
};

function ConfidenceBadge({ level }: { level: string }) {
  return (
    <span className={`ml-2 rounded-full px-2 py-0.5 font-mono text-[10px] font-bold uppercase ${CONFIDENCE_STYLE[level] ?? CONFIDENCE_STYLE.low}`}>
      {level} confidence
    </span>
  );
}

export default async function CompetitorsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const analysis = await getAnalysisWithProfile(id);
  if (!analysis || !analysis.profile) return notFound();

  const profile = analysis.profile;
  const aliases: string[] = JSON.parse(profile.aliases);
  const suggestedCompetitors: CompetitorSuggestion[] = JSON.parse(profile.suggestedCompetitors);
  const direct = suggestedCompetitors.filter((c) => c.type === "direct");
  const indirect = suggestedCompetitors.filter((c) => c.type === "indirect");

  return (
    <div className="min-h-screen bg-neutral-50">
      {analysis.isDemo && <DemoBanner />}
      <div className="mx-auto max-w-3xl px-6 py-10">
        <Link href={`/analysis/${id}/profile`} className="text-sm text-neutral-500 hover:underline">
          ← Back to profile
        </Link>

        <header className="mt-2 mb-4">
          <StepIndicator current="Competitors" />
          <h1 className="text-2xl font-bold text-neutral-900">{analysis.companyName}</h1>
          {aliases.length > 0 && (
            <p className="mt-1 text-xs text-neutral-400">
              Also tracked as: {aliases.join(", ")}
            </p>
          )}
          <p className="mt-1 flex items-center text-sm text-neutral-500">
            Pick 3–5 to track. Bad competitor sets ruin the analysis — this is the checkpoint that matters most.
            <SourceBadge source={profile.competitorsSource} />
            {!profile.competitorsGrounded && (
              <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-amber-800">
                unverified
              </span>
            )}
          </p>
        </header>

        {direct.length < 3 && (
          <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            Only {direct.length} direct competitor{direct.length === 1 ? "" : "s"} found from grounded sources — fewer
            than the 3 recommended. Add more below before confirming, if you know of others.
          </div>
        )}

        <form action={confirmCompetitorsAction.bind(null, analysis.id)} className="space-y-6">
          <div className="rounded-lg border border-neutral-200 bg-white p-5">
            <input type="hidden" name="allSuggested" value={JSON.stringify(suggestedCompetitors)} />

            <fieldset className="mb-5">
              <legend className="mb-2 text-xs font-bold uppercase tracking-wide text-emerald-700">
                Direct competitors — same product category
              </legend>
              <div className="space-y-2">
                {direct.map((c) => (
                  <label key={c.name} className="flex items-start gap-3 rounded-md border border-emerald-200 bg-emerald-50/50 p-3">
                    <input type="checkbox" name="competitor" value={c.name} defaultChecked className="mt-1" />
                    <div>
                      <div className="text-sm font-semibold text-neutral-900">
                        {c.name}
                        {c.url && <span className="ml-2 font-mono text-xs font-normal text-neutral-400">{c.url}</span>}
                        <ConfidenceBadge level={c.confidence} />
                      </div>
                      <p className="text-xs text-neutral-600">{c.rationale}</p>
                      <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wide text-neutral-400">Source: {c.discoverySource}</p>
                      {c.aliases?.length > 0 && (
                        <p className="mt-0.5 text-xs text-neutral-400">
                          Also known as: {c.aliases.join(", ")}
                          {!c.aliasesVerified && (
                            <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase text-amber-800">
                              unverified — not used for brand matching
                            </span>
                          )}
                        </p>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            </fieldset>

            {indirect.length > 0 && (
              <fieldset className="mb-5">
                <legend className="mb-2 text-xs font-bold uppercase tracking-wide text-neutral-500">
                  Indirect alternatives — adjacent, but a different product
                </legend>
                <div className="space-y-2">
                  {indirect.map((c) => (
                    <label key={c.name} className="flex items-start gap-3 rounded-md border border-neutral-200 bg-neutral-50 p-3">
                      <input type="checkbox" name="competitor" value={c.name} className="mt-1" />
                      <div>
                        <div className="text-sm font-semibold text-neutral-900">
                          {c.name}
                          {c.url && <span className="ml-2 font-mono text-xs font-normal text-neutral-400">{c.url}</span>}
                          <ConfidenceBadge level={c.confidence} />
                        </div>
                        <p className="text-xs text-neutral-600">{c.rationale}</p>
                        {c.aliases?.length > 0 && (
                          <p className="mt-0.5 text-xs text-neutral-400">
                            Also known as: {c.aliases.join(", ")}
                            {!c.aliasesVerified && (
                              <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase text-amber-800">
                                unverified — not used for brand matching
                              </span>
                            )}
                          </p>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}

            <button className="rounded-md bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90">
              Confirm &amp; generate prompts →
            </button>
          </div>
        </form>

        <div className="mt-4 rounded-lg border border-dashed border-neutral-300 bg-white p-4">
          <h2 className="mb-2 font-mono text-xs uppercase tracking-wide text-neutral-500">Add a competitor not listed</h2>
          <form action={addCustomCompetitorAction.bind(null, analysis.id)} className="flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Name</span>
              <input name="newCompetitorName" required className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm" />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Domain (optional)</span>
              <input name="newCompetitorUrl" placeholder="example.com" className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm" />
            </label>
            <button className="rounded-md border border-neutral-300 bg-white px-4 py-1.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-50">
              Add
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
