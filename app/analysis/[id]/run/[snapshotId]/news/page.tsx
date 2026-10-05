import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { computeCoverageGaps } from "@/lib/coverageGaps";
import { DEFAULT_LOOKBACK_DAYS, WIDE_LOOKBACK_DAYS } from "@/lib/newsScan";
import { DemoBanner } from "@/components/DemoBanner";
import { StepIndicator } from "@/components/StepIndicator";
import { restoreNewsArticleAction, widenNewsSearchAction, resumeFailedNewsQueriesAction, confirmNewsScanCompleteAction } from "../../../../actions";

const SENTIMENT_STYLE: Record<string, string> = {
  positive: "bg-emerald-100 text-emerald-700",
  neutral: "bg-neutral-200 text-neutral-600",
  negative: "bg-red-100 text-red-700",
};

const MENTION_TYPE_LABEL: Record<string, string> = {
  primary_subject: "primary subject",
  quoted_or_cited: "quoted / cited",
  passing_mention: "passing mention",
};
const MENTION_TYPE_STYLE: Record<string, string> = {
  primary_subject: "bg-blue-100 text-blue-700",
  quoted_or_cited: "bg-violet-100 text-violet-700",
  passing_mention: "bg-neutral-100 text-neutral-500",
};

const OUTCOME_STYLE: Record<string, string> = {
  success: "bg-emerald-100 text-emerald-700",
  empty: "bg-neutral-200 text-neutral-600",
  rate_limited: "bg-amber-100 text-amber-800",
  error: "bg-red-100 text-red-700",
};

function weekKey(d: Date): string {
  const onejan = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - onejan.getTime()) / 86400000 + onejan.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

export default async function NewsScanPage({ params }: { params: Promise<{ id: string; snapshotId: string }> }) {
  const { id, snapshotId } = await params;
  const analysis = await prisma.analysis.findUnique({ where: { id } });
  const snapshot = await prisma.snapshot.findUnique({ where: { id: snapshotId } });
  if (!analysis || !snapshot) return notFound();

  const allArticles = await prisma.newsArticle.findMany({
    where: { snapshotId },
    orderBy: [{ brand: "asc" }, { publishedAt: "desc" }],
  });
  const included = allArticles.filter((a) => !a.excluded);
  const excluded = allArticles.filter((a) => a.excluded);

  const byBrandIncluded = new Map<string, typeof included>();
  for (const a of included) {
    if (!byBrandIncluded.has(a.brand)) byBrandIncluded.set(a.brand, []);
    byBrandIncluded.get(a.brand)!.push(a);
  }
  const brands = [...new Set(allArticles.map((a) => a.brand))].sort((a, b) =>
    a === analysis.companyName ? -1 : b === analysis.companyName ? 1 : 0
  );

  // Before/after filter counts, per brand — every number here is a count of
  // real rows in the DB (see lib/newsScan.ts's excluded/exclusionReason).
  const beforeAfter = brands.map((brand) => {
    const brandAll = allArticles.filter((a) => a.brand === brand);
    const brandIncluded = brandAll.filter((a) => !a.excluded);
    return { brand, before: brandAll.length, after: brandIncluded.length };
  });

  // Share of media voice — % of non-excluded articles per brand, overall and
  // broken down by how central the mention actually is.
  const shareOfVoice = brands
    .map((brand) => ({ brand, count: byBrandIncluded.get(brand)?.length ?? 0 }))
    .map((b) => ({ ...b, pct: included.length ? Math.round((100 * b.count) / included.length) : 0 }))
    .sort((a, b) => b.count - a.count);

  const shareByMentionType = brands.map((brand) => {
    const rows = byBrandIncluded.get(brand) ?? [];
    const counts = { primary_subject: 0, quoted_or_cited: 0, passing_mention: 0 };
    for (const r of rows) {
      if (r.mentionType && r.mentionType in counts) counts[r.mentionType as keyof typeof counts]++;
    }
    return { brand, ...counts, total: rows.length };
  });

  // Weekly volume — count of non-excluded articles per ISO-ish week.
  const weeklyMap = new Map<string, number>();
  for (const a of included) {
    const k = weekKey(a.publishedAt);
    weeklyMap.set(k, (weeklyMap.get(k) ?? 0) + 1);
  }
  const weekly = [...weeklyMap.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const maxWeekly = Math.max(1, ...weekly.map(([, c]) => c));

  // Top outlets — domain frequency among non-excluded articles.
  const domainMap = new Map<string, number>();
  for (const a of included) domainMap.set(a.domain, (domainMap.get(a.domain) ?? 0) + 1);
  const topOutlets = [...domainMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);

  const exclusionReasonCounts = new Map<string, number>();
  for (const a of excluded) {
    const reason = a.exclusionReason ?? "unknown";
    exclusionReasonCounts.set(reason, (exclusionReasonCounts.get(reason) ?? 0) + 1);
  }

  const coverageGaps = await computeCoverageGaps(snapshotId);

  const queryLogs = await prisma.newsQueryLog.findMany({
    where: { snapshotId },
    orderBy: { queriedAt: "desc" },
  });
  const anyRateLimited = queryLogs.some((q) => q.outcome === "rate_limited" || q.outcome === "error");

  // newsScanStatus is authoritative for the scan's own state — set at the
  // start and end of every runNewsScan call, regardless of what the overall
  // snapshot.status happens to be (that field tracks the AI-visibility run
  // too, and a caller that invokes the scan standalone, like "resume failed
  // queries," isn't obligated to touch it).
  const newsScanStatus = snapshot.newsScanStatus ?? (allArticles.length > 0 || queryLogs.length > 0 ? "complete" : null);
  const scanning = newsScanStatus === "running";
  const failedQueryCount = new Map<string, boolean>();
  for (const q of [...queryLogs].reverse()) failedQueryCount.set(q.query, q.outcome === "rate_limited" || q.outcome === "error");
  const failedBrandCount = [...failedQueryCount.values()].filter(Boolean).length;

  // A brand that returned raw articles but ended with zero included is a
  // signal the filters may have over-excluded, not proof the coverage is
  // genuinely empty — never present share of voice as final without either
  // fixing that or the user explicitly accepting it.
  const hasSuspiciousZero = beforeAfter.some((b) => b.before > 0 && b.after === 0);
  const isIncomplete = newsScanStatus === "partial" || newsScanStatus === "failed" || hasSuspiciousZero;
  const showShareOfVoice = !isIncomplete || snapshot.newsScanUserConfirmed;

  return (
    <div className="min-h-screen bg-neutral-50">
      {analysis.isDemo && <DemoBanner />}
      <div className="mx-auto max-w-4xl px-6 py-10">
        <StepIndicator current="Run" />
        <Link href={`/analysis/${id}/run/${snapshotId}/review`} className="text-sm text-neutral-500 hover:underline">
          ← Back to run results
        </Link>
        <header className="mt-2 mb-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-2xl font-bold text-neutral-900">{analysis.companyName} — Media landscape</h1>
            <form action={widenNewsSearchAction.bind(null, id, snapshotId)}>
              <button className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50">
                Widen search ({WIDE_LOOKBACK_DAYS} days)
              </button>
            </form>
          </div>
          <p className="mt-1 text-sm text-neutral-500">
            {included.length} article{included.length !== 1 ? "s" : ""} included across {brands.length} brand
            {brands.length !== 1 ? "s" : ""} (last {DEFAULT_LOOKBACK_DAYS} days by default), {excluded.length} filtered
            out — all from the live GDELT API, nothing seeded. Each included article is classified by Groq as primary
            subject, quoted/cited, or a passing mention — judged from the actual article text where it can be fetched,
            not the headline alone, so a brand that's a survey sponsor or quoted source isn't wrongly excluded. Only a
            genuine name collision (a different meaning of the same word entirely) is excluded. Syndicated copies of
            the same story are rolled into one entry with a syndication count, not dropped as duplicates.
          </p>
        </header>

        {newsScanStatus && (
          <div
            className={`mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4 text-sm ${
              newsScanStatus === "running"
                ? "border-amber-300 bg-amber-50 text-amber-900"
                : newsScanStatus === "complete"
                ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                : newsScanStatus === "partial"
                ? "border-amber-300 bg-amber-50 text-amber-900"
                : "border-red-300 bg-red-50 text-red-900"
            }`}
          >
            <div>
              <span className="font-mono text-xs font-bold uppercase">{newsScanStatus}</span>
              {snapshot.newsScanAt && (
                <span className="ml-2 text-xs opacity-80">as of {snapshot.newsScanAt.toISOString().slice(0, 16).replace("T", " ")} UTC</span>
              )}
              {newsScanStatus === "running" && <span className="ml-2">News scan still running — refresh in a moment.</span>}
              {(newsScanStatus === "partial" || newsScanStatus === "failed") && (
                <span className="ml-2">{failedBrandCount} brand{failedBrandCount !== 1 ? "s" : ""} rate-limited or errored on the last attempt.</span>
              )}
            </div>
            {(newsScanStatus === "partial" || newsScanStatus === "failed") && (
              <form action={resumeFailedNewsQueriesAction.bind(null, id, snapshotId)}>
                <button className="shrink-0 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50">
                  Resume failed queries only
                </button>
              </form>
            )}
          </div>
        )}

        {queryLogs.length > 0 && (
          <div className="mb-6 rounded-lg border border-neutral-200 bg-white p-5">
            <h2 className="mb-1 font-mono text-xs uppercase tracking-wide text-neutral-500">Query diagnostics</h2>
            <p className="mb-3 text-xs text-neutral-500">
              Every GDELT request actually attempted for this scan — a rate limit or error is recorded distinctly from
              a genuinely empty result, never collapsed into "no articles."
            </p>
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-neutral-400">
                <tr>
                  <th className="pb-1 pr-3">Query</th>
                  <th className="pb-1 pr-3">Outcome</th>
                  <th className="pb-1 pr-3">Results</th>
                  <th className="pb-1 pr-3">Cached</th>
                  <th className="pb-1">Detail</th>
                </tr>
              </thead>
              <tbody>
                {queryLogs.map((q) => (
                  <tr key={q.id} className="border-t border-neutral-100">
                    <td className="py-1 pr-3 font-medium text-neutral-800">{q.query}</td>
                    <td className="py-1 pr-3">
                      <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-bold uppercase ${OUTCOME_STYLE[q.outcome] ?? "bg-neutral-100 text-neutral-500"}`}>
                        {q.outcome.replace("_", " ")}
                      </span>
                    </td>
                    <td className="py-1 pr-3 text-neutral-600">{q.resultCount}</td>
                    <td className="py-1 pr-3 text-neutral-500">{q.cached ? "yes" : "no"}</td>
                    <td className="max-w-xs truncate py-1 text-xs text-neutral-400">{q.errorMessage ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!scanning && allArticles.length === 0 && (
          <div className="mb-6 rounded-lg border border-neutral-200 bg-white p-6 text-sm text-neutral-500">
            {anyRateLimited ? (
              <>
                No articles found — and the diagnostics above show at least one query was rate-limited or errored,
                not genuinely empty. Try "Widen search" above, or wait a bit and re-run the news scan — GDELT throttles
                this environment's shared IP.
              </>
            ) : (
              <>No articles found for this run — every query above came back genuinely empty in the lookback window, not rate-limited.</>
            )}
          </div>
        )}

        {allArticles.length > 0 && (
          <>
            <div className="mb-6 rounded-lg border border-neutral-200 bg-white p-5">
              <h2 className="mb-3 font-mono text-xs uppercase tracking-wide text-neutral-500">Before / after filtering</h2>
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-neutral-400">
                  <tr>
                    <th className="pb-1 pr-3">Brand</th>
                    <th className="pb-1 pr-3">Raw from GDELT</th>
                    <th className="pb-1">Included after filters</th>
                  </tr>
                </thead>
                <tbody>
                  {beforeAfter.map((b) => (
                    <tr key={b.brand} className="border-t border-neutral-100">
                      <td className="py-1 pr-3 font-medium text-neutral-800">{b.brand}</td>
                      <td className="py-1 pr-3 text-neutral-600">{b.before}</td>
                      <td className="py-1 text-neutral-600">{b.after}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {exclusionReasonCounts.size > 0 && (
                <p className="mt-3 text-xs text-neutral-500">
                  Filtered out: {[...exclusionReasonCounts.entries()].map(([reason, n]) => `${n} ${reason}`).join(" · ")}
                </p>
              )}
            </div>

            {!showShareOfVoice && (
              <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-5 text-sm text-amber-900">
                <h2 className="mb-1 font-mono text-xs uppercase tracking-wide text-amber-800">Share of voice hidden — scan incomplete</h2>
                <p className="mb-3">
                  {newsScanStatus === "partial" || newsScanStatus === "failed"
                    ? "Some brand queries were rate-limited or errored, so this snapshot's coverage isn't the full picture yet."
                    : "At least one brand returned raw GDELT articles but ended with zero included — that can mean the filters over-excluded real coverage, not that the coverage is genuinely empty."}{" "}
                  Resume the failed queries above, or confirm this result is final to show it anyway.
                </p>
                <form action={confirmNewsScanCompleteAction.bind(null, id, snapshotId)}>
                  <button className="rounded-md border border-amber-400 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100">
                    Show share of voice anyway — this result is final
                  </button>
                </form>
              </div>
            )}

            <div className="mb-6 grid gap-6 sm:grid-cols-2">
              {showShareOfVoice && (
              <div className="rounded-lg border border-neutral-200 bg-white p-5">
                <h2 className="mb-3 font-mono text-xs uppercase tracking-wide text-neutral-500">Share of media voice</h2>
                <div className="space-y-2">
                  {shareOfVoice.map((b) => (
                    <div key={b.brand}>
                      <div className="mb-0.5 flex justify-between text-xs text-neutral-600">
                        <span>{b.brand}</span>
                        <span>{b.pct}% ({b.count})</span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-100">
                        <div className="h-full bg-neutral-900" style={{ width: `${b.pct}%` }} />
                      </div>
                    </div>
                  ))}
                  {shareOfVoice.every((b) => b.count === 0) && <p className="text-xs text-neutral-400">No included articles yet.</p>}
                </div>
                {included.length > 0 && (
                  <table className="mt-4 w-full text-xs">
                    <thead className="text-left uppercase tracking-wide text-neutral-400">
                      <tr>
                        <th className="pb-1 pr-2">By mention type</th>
                        <th className="pb-1 pr-2">Primary</th>
                        <th className="pb-1 pr-2">Quoted/cited</th>
                        <th className="pb-1">Passing</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shareByMentionType.filter((b) => b.total > 0).map((b) => (
                        <tr key={b.brand} className="border-t border-neutral-100">
                          <td className="py-1 pr-2 font-medium text-neutral-700">{b.brand}</td>
                          <td className="py-1 pr-2 text-neutral-600">{b.primary_subject}</td>
                          <td className="py-1 pr-2 text-neutral-600">{b.quoted_or_cited}</td>
                          <td className="py-1 text-neutral-600">{b.passing_mention}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              )}

              <div className="rounded-lg border border-neutral-200 bg-white p-5">
                <h2 className="mb-3 font-mono text-xs uppercase tracking-wide text-neutral-500">Top outlets</h2>
                <div className="space-y-1.5">
                  {topOutlets.map(([domain, count]) => (
                    <div key={domain} className="flex items-center justify-between text-xs text-neutral-600">
                      <span className="truncate">{domain}</span>
                      <span className="ml-2 shrink-0 font-mono text-neutral-400">{count}</span>
                    </div>
                  ))}
                  {topOutlets.length === 0 && <p className="text-xs text-neutral-400">No included articles yet.</p>}
                </div>
              </div>
            </div>

            <div className="mb-6 rounded-lg border border-neutral-200 bg-white p-5">
              <h2 className="mb-3 font-mono text-xs uppercase tracking-wide text-neutral-500">Weekly volume</h2>
              <div className="space-y-1.5">
                {weekly.map(([week, count]) => (
                  <div key={week} className="flex items-center gap-2 text-xs text-neutral-600">
                    <span className="w-20 shrink-0 font-mono">{week}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-100">
                      <div className="h-full bg-blue-500" style={{ width: `${(100 * count) / maxWeekly}%` }} />
                    </div>
                    <span className="w-6 shrink-0 text-right font-mono">{count}</span>
                  </div>
                ))}
                {weekly.length === 0 && <p className="text-xs text-neutral-400">No included articles yet.</p>}
              </div>
            </div>

            <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-5">
              <h2 className="mb-1 font-mono text-xs uppercase tracking-wide text-amber-800">Coverage gaps that shape AI answers</h2>
              <p className="mb-3 text-xs text-amber-900/80">
                {analysis.companyName} has {coverageGaps.targetNewsCount} of {coverageGaps.totalNewsCount} included
                articles this period
                {showShareOfVoice ? ` (${coverageGaps.targetSharePct}% share of voice)` : " — share of voice not shown until the scan above is resolved or confirmed"}
                . Below are prompts where it was mentioned in zero grounded AI answers — a press/content gap worth
                closing if that share of voice isn't already reflected there.
              </p>
              {coverageGaps.gaps.length > 0 ? (
                <ul className="space-y-1.5">
                  {coverageGaps.gaps.map((g, i) => (
                    <li key={i} className="rounded-md border border-amber-200 bg-white p-2.5 text-sm text-neutral-700">
                      <span className="mr-2 rounded-full bg-amber-200 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-amber-900">
                        {g.theme}
                      </span>
                      {g.promptText}
                      <span className="ml-2 text-xs text-neutral-400">(0/{g.totalRuns} grounded runs)</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-amber-900/70">No zero-mention prompts found in this run's grounded results.</p>
              )}
            </div>

            <div className="space-y-6">
              {brands.map((brand) => (
                <div key={brand} className="rounded-lg border border-neutral-200 bg-white p-5">
                  <h2 className="mb-3 flex items-center gap-2 font-mono text-xs uppercase tracking-wide text-neutral-500">
                    {brand}
                    {brand === analysis.companyName && (
                      <span className="rounded-full bg-neutral-900 px-2 py-0.5 text-[10px] font-bold uppercase text-white">target</span>
                    )}
                    <span className="text-neutral-400">· {byBrandIncluded.get(brand)?.length ?? 0}</span>
                  </h2>
                  <ul className="space-y-3">
                    {(byBrandIncluded.get(brand) ?? []).map((a) => {
                      const outlets: string[] = a.syndicatedOutlets ? JSON.parse(a.syndicatedOutlets) : [];
                      return (
                        <li key={a.id} className="border-b border-neutral-100 pb-3 last:border-0 last:pb-0">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <a href={a.url} target="_blank" rel="noreferrer" className="font-medium text-blue-600 hover:underline">
                              {a.title}
                            </a>
                            <div className="flex shrink-0 gap-1">
                              {a.mentionType && (
                                <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-bold uppercase ${MENTION_TYPE_STYLE[a.mentionType] ?? "bg-neutral-100 text-neutral-500"}`}>
                                  {MENTION_TYPE_LABEL[a.mentionType] ?? a.mentionType}
                                </span>
                              )}
                              <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-bold uppercase ${SENTIMENT_STYLE[a.sentiment ?? ""] ?? "bg-neutral-100 text-neutral-500"}`}>
                                {a.sentiment ?? "not classified"}
                              </span>
                            </div>
                          </div>
                          <p className="mt-1 text-xs text-neutral-500">
                            {a.domain} · {a.publishedAt.toISOString().slice(0, 10)} · {a.topic ?? "—"} ·{" "}
                            <span className="uppercase">{a.classificationSource ?? "unclassified"}</span>
                            {a.syndicatedCount > 1 && (
                              <span className="ml-1 font-semibold text-neutral-600">
                                · 1 story, {a.syndicatedCount} outlets ({outlets.slice(0, 4).join(", ")}
                                {outlets.length > 4 ? `, +${outlets.length - 4} more` : ""})
                              </span>
                            )}
                          </p>
                        </li>
                      );
                    })}
                    {(byBrandIncluded.get(brand) ?? []).length === 0 && <p className="text-xs text-neutral-400">No included articles for this brand.</p>}
                  </ul>
                </div>
              ))}
            </div>

            {excluded.length > 0 && (
              <details className="mt-6 rounded-lg border border-dashed border-neutral-300 bg-white p-5">
                <summary className="cursor-pointer font-mono text-xs uppercase tracking-wide text-neutral-500">
                  Excluded articles ({excluded.length}) — filtered out, not deleted
                </summary>
                <ul className="mt-3 space-y-2">
                  {excluded.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-neutral-100 pt-2 text-sm">
                      <div className="min-w-0">
                        <a href={a.url} target="_blank" rel="noreferrer" className="text-neutral-700 hover:underline">
                          {a.title}
                        </a>
                        <p className="text-xs text-neutral-400">
                          {a.brand} · {a.domain} · {a.publishedAt.toISOString().slice(0, 10)} · reason: {a.exclusionReason ?? "unknown"}
                        </p>
                      </div>
                      <form action={restoreNewsArticleAction.bind(null, id, snapshotId, a.id)}>
                        <button className="shrink-0 rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-xs font-semibold text-neutral-700 hover:bg-neutral-50">
                          Restore
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </div>
    </div>
  );
}
