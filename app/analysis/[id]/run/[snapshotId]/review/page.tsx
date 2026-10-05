import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSnapshotResponses } from "@/lib/runEngine";
import { getLatestJudgeAgreementReport } from "@/lib/judgeAgreement";
import { DemoBanner } from "@/components/DemoBanner";
import { StepIndicator } from "@/components/StepIndicator";
import { runJudgeAgreementCheckAction } from "../../../../actions";

function StatCell({ label, pct }: { label: string; pct: number }) {
  const color = pct >= 90 ? "text-emerald-700" : pct >= 70 ? "text-amber-700" : "text-red-700";
  return (
    <div className="rounded-md border border-neutral-200 bg-white p-3 text-center">
      <div className={`text-xl font-bold ${color}`}>{pct}%</div>
      <div className="mt-1 font-mono text-[10px] uppercase tracking-wide text-neutral-500">{label}</div>
    </div>
  );
}

async function JudgeQualityPanel({ analysisId, snapshotId }: { analysisId: string; snapshotId: string }) {
  const report = await getLatestJudgeAgreementReport();

  return (
    <div className="mb-6 rounded-lg border border-neutral-200 bg-neutral-50 p-5">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="font-mono text-xs uppercase tracking-wide text-neutral-500">Judge quality</h2>
          <p className="mt-1 text-xs text-neutral-500">
            Runs the currently-configured judge model against the demo's seeded ground truth (the only place a correct
            answer is actually known) — re-runnable any time the judge model in Settings changes, so results stay
            comparable across models.
          </p>
        </div>
        <form action={runJudgeAgreementCheckAction.bind(null, analysisId, snapshotId)}>
          <button className="shrink-0 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50">
            Run judge quality check
          </button>
        </form>
      </div>

      {report ? (
        <>
          <p className="mb-3 text-xs text-neutral-500">
            Last run {report.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC against{" "}
            <span className="font-semibold">{report.judgeProvider}/{report.judgeModel}</span>, {report.fixturesTested}{" "}
            fixtures.
          </p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            <StatCell label="Brand set" pct={report.brandSetMatchPct} />
            <StatCell label="Order" pct={report.orderMatchPct} />
            <StatCell label="Positioning" pct={report.positioningMatchPct} />
            <StatCell label="Sentiment" pct={report.sentimentMatchPct} />
            <StatCell label="Citation" pct={report.citationMatchPct} />
            <div className="rounded-md border border-neutral-200 bg-white p-3 text-center">
              <div className="text-xl font-bold text-neutral-800">{report.consistencyFailures}</div>
              <div className="mt-1 font-mono text-[10px] uppercase tracking-wide text-neutral-500">Consistency fails</div>
            </div>
          </div>
          {report.disagreementExamples.length > 0 && (
            <details className="mt-3 text-xs text-neutral-600">
              <summary className="cursor-pointer font-semibold text-neutral-700">
                {report.disagreementExamples.length} example disagreement{report.disagreementExamples.length !== 1 ? "s" : ""}
              </summary>
              <ul className="mt-2 space-y-1 font-mono text-[11px]">
                {report.disagreementExamples.map((ex, i) => (
                  <li key={i} className="border-t border-neutral-100 pt-1">{ex}</li>
                ))}
              </ul>
            </details>
          )}
        </>
      ) : (
        <p className="text-xs text-neutral-500">Never run yet — click "Run judge quality check" (calls the judge model once per demo fixture, takes a few minutes).</p>
      )}
    </div>
  );
}

export default async function ReviewListPage({ params }: { params: Promise<{ id: string; snapshotId: string }> }) {
  const { id, snapshotId } = await params;
  const analysis = await prisma.analysis.findUnique({ where: { id } });
  const snapshot = await prisma.snapshot.findUnique({ where: { id: snapshotId } });
  if (!analysis || !snapshot) return notFound();

  const responses = await getSnapshotResponses(snapshotId);
  const okCount = responses.filter((r) => r.status === "ok").length;
  const errorCount = responses.filter((r) => r.status === "error").length;
  const flaggedCount = responses.filter((r) => r.extraction?.flaggedForReview).length;
  const correctedCount = responses.filter((r) => r.extraction?.correctedBrandMentions).length;

  return (
    <div className="min-h-screen bg-neutral-50">
      {analysis.isDemo && <DemoBanner />}
      <div className="mx-auto max-w-4xl px-6 py-10">
        <StepIndicator current="Run" />
        <header className="mb-6">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-neutral-900">{analysis.companyName} — Run #{snapshot.runNumber}</h1>
            <Link
              href={`/analysis/${id}/run/${snapshotId}/news`}
              className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-50"
            >
              Media landscape →
            </Link>
          </div>
          <p className="mt-1 text-sm text-neutral-500">
            {okCount} ok · {errorCount} failed · {flaggedCount} flagged for review · {correctedCount} corrected · engines:{" "}
            {JSON.parse(snapshot.engines).join(", ")}
          </p>
        </header>

        {analysis.isDemo && <JudgeQualityPanel analysisId={id} snapshotId={snapshotId} />}

        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-3 py-2">Prompt</th>
                <th className="px-3 py-2">Engine</th>
                <th className="px-3 py-2">Mode</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Brands</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {responses.map((r) => {
                const mentions = r.extraction
                  ? JSON.parse(r.extraction.correctedBrandMentions ?? r.extraction.brandMentions)
                  : [];
                return (
                  <tr key={r.id} className="border-t border-neutral-100">
                    <td className="max-w-xs truncate px-3 py-2 text-neutral-700">{r.prompt.text}</td>
                    <td className="px-3 py-2 text-neutral-600">{r.engine}</td>
                    <td className="px-3 py-2 text-neutral-500">
                      {r.mode}
                      {r.sampleIndex > 0 && ` · #${r.sampleIndex + 1}`}
                    </td>
                    <td className="px-3 py-2">
                      {r.status === "ok" ? (
                        r.extraction?.flaggedForReview ? (
                          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">flagged</span>
                        ) : r.extraction?.correctedBrandMentions ? (
                          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-700">corrected</span>
                        ) : (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700">ok</span>
                        )
                      ) : (
                        <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-xs font-bold text-neutral-600">error</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-neutral-600">
                      {mentions.map((m: { brand: string; isTarget?: boolean }) => m.brand).join(", ") || (r.status === "error" ? "—" : "none")}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Link href={`/analysis/${id}/run/${snapshotId}/review/${r.id}`} className="font-semibold text-blue-600 hover:underline">
                        Open →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
