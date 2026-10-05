import { notFound } from "next/navigation";
import Link from "next/link";
import { getResponseDetail } from "@/lib/runEngine";
import { prisma } from "@/lib/db";
import { DemoBanner } from "@/components/DemoBanner";
import { SourceBadge } from "@/components/SourceBadge";
import { correctExtractionAction } from "../../../../../actions";

export default async function ResponseDetailPage({
  params,
}: {
  params: Promise<{ id: string; snapshotId: string; responseId: string }>;
}) {
  const { id, snapshotId, responseId } = await params;
  const analysis = await prisma.analysis.findUnique({ where: { id } });
  const response = await getResponseDetail(responseId);
  if (!analysis || !response) return notFound();

  const citations: { url: string | null; domain: string }[] = response.citations ? JSON.parse(response.citations) : [];
  const judgeMentions = response.extraction ? JSON.parse(response.extraction.brandMentions) : [];
  const correctedMentions = response.extraction?.correctedBrandMentions ? JSON.parse(response.extraction.correctedBrandMentions) : null;
  const effectiveMentions = correctedMentions ?? judgeMentions;

  return (
    <div className="min-h-screen bg-neutral-50">
      {analysis.isDemo && <DemoBanner />}
      <div className="mx-auto max-w-5xl px-6 py-10">
        <Link href={`/analysis/${id}/run/${snapshotId}/review`} className="text-sm text-neutral-500 hover:underline">
          ← Back to run results
        </Link>

        <header className="mt-2 mb-6">
          <h1 className="text-xl font-bold text-neutral-900">{response.engine} · {response.mode}{response.sampleIndex > 0 ? ` · sample ${response.sampleIndex + 1}` : ""}</h1>
          <p className="mt-1 text-sm text-neutral-500">{response.prompt.text}</p>
          <p className="mt-1 text-xs text-neutral-400">
            model: {response.model} · latency: {response.latencyMs ?? "—"}ms · retries: {response.retryCount} · cost: $
            {response.costUsd?.toFixed(4) ?? "0"}
            {response.cachedFrom && " · served from cache"}
          </p>
        </header>

        {response.status === "error" ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-800">
            <p className="font-semibold">This call failed after {response.retryCount} retries.</p>
            <p className="mt-1 font-mono text-xs">{response.errorMessage}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="rounded-lg border border-neutral-200 bg-white p-5">
              <h2 className="mb-2 font-mono text-xs uppercase tracking-wide text-neutral-500">Raw response text</h2>
              <p className="whitespace-pre-wrap text-sm text-neutral-800">{response.fullText}</p>
              {citations.length > 0 && (
                <>
                  <h3 className="mb-1 mt-4 font-mono text-xs uppercase tracking-wide text-neutral-500">Citations</h3>
                  <ul className="text-xs text-neutral-500">
                    {citations.map((c, i) => (
                      <li key={i}>{c.domain}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>

            <div className="rounded-lg border border-neutral-200 bg-white p-5">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="flex items-center font-mono text-xs uppercase tracking-wide text-neutral-500">
                  Judge extraction
                  <SourceBadge source={response.extraction?.judgeSource} />
                </h2>
                {response.extraction?.flaggedForReview && (
                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold uppercase text-red-700">
                    flagged for review
                  </span>
                )}
              </div>
              <p className="mb-3 text-xs text-neutral-400">
                judge model: {response.extraction?.judgeModel ?? "ground truth (demo, no reasoning key configured)"}
                {response.extraction?.wasRetried && " · retried once"}
              </p>

              {effectiveMentions.length === 0 ? (
                <p className="text-sm text-neutral-500">No tracked brands extracted for this response.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead className="text-left uppercase text-neutral-400">
                    <tr>
                      <th className="py-1">Brand</th>
                      <th className="py-1">Rank</th>
                      <th className="py-1">Positioning</th>
                      <th className="py-1">Sentiment</th>
                      <th className="py-1">Cited</th>
                    </tr>
                  </thead>
                  <tbody>
                    {effectiveMentions.map((m: { brand: string; rank: number; positioning: string; sentiment: string; ownDomainCited: boolean; isTarget?: boolean }, i: number) => (
                      <tr key={i} className="border-t border-neutral-100">
                        <td className="py-1.5 font-medium text-neutral-900">
                          {m.brand}
                          {m.isTarget && <span className="ml-1 text-blue-600">★</span>}
                        </td>
                        <td className="py-1.5">{m.rank}</td>
                        <td className="py-1.5">{m.positioning}</td>
                        <td className="py-1.5">{m.sentiment}</td>
                        <td className="py-1.5">{m.ownDomainCited ? "yes" : "no"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {correctedMentions && (
                <p className="mt-3 text-xs text-blue-700">
                  Corrected by {response.extraction?.correctedBy} — judge's original output is still kept, not overwritten.
                </p>
              )}

              <details className="mt-4">
                <summary className="cursor-pointer text-xs font-semibold text-neutral-500">Correct this extraction</summary>
                <form action={correctExtractionAction.bind(null, id, snapshotId, responseId)} className="mt-2 space-y-2">
                  <textarea
                    name="correctedJson"
                    defaultValue={JSON.stringify(effectiveMentions, null, 2)}
                    rows={10}
                    className="w-full rounded-md border border-neutral-300 p-2 font-mono text-xs"
                  />
                  <button className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90">
                    Save correction
                  </button>
                  <p className="text-[11px] text-neutral-400">
                    Edit the JSON directly (brand, rank, positioning, sentiment, ownDomainCited, isTarget). Metrics use this
                    corrected version once saved.
                  </p>
                </form>
              </details>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
