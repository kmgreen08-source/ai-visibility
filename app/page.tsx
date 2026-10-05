import Link from "next/link";
import { prisma } from "@/lib/db";
import { configuredEngines } from "@/lib/providers";
import { DemoBanner } from "@/components/DemoBanner";
import { startHometapDemoAction } from "./analysis/actions";

function hasGroqConfigured(): boolean {
  return Boolean(process.env.GROQ_API_KEY);
}

function openHref(a: { id: string; status: string; snapshots: { id: string; status: string }[] }): string {
  const latest = a.snapshots[0];
  if (latest) {
    if (latest.status === "running") return `/analysis/${a.id}/run/${latest.id}`;
    return `/analysis/${a.id}/run/${latest.id}/review`;
  }
  if (a.status === "profiling") return `/analysis/${a.id}/profile`;
  if (a.status === "ready") return `/analysis/${a.id}/run`;
  return `/analysis/${a.id}/prompts`;
}

export default async function DashboardPage() {
  const analyses = await prisma.analysis.findMany({
    orderBy: { createdAt: "desc" },
    include: { snapshots: { orderBy: { runNumber: "desc" }, take: 1 } },
  });
  const hasLiveEngines = configuredEngines().length > 0;
  const hasGroq = hasGroqConfigured();
  const hasDemo = analyses.some((a) => a.isDemo);

  return (
    <div className="min-h-screen bg-neutral-50">
      {hasDemo && <DemoBanner />}
      <div className="mx-auto max-w-4xl px-6 py-10">
        <header className="mb-8 flex items-center justify-between">
          <div>
            <p className="font-mono text-xs uppercase tracking-wide text-neutral-500">AI Visibility &amp; Media Landscape</p>
            <h1 className="text-2xl font-bold text-neutral-900">Analyses</h1>
          </div>
          <div className="flex gap-2">
            <form action={startHometapDemoAction}>
              <button className="rounded-md border border-amber-500 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100">
                Start Hometap demo
              </button>
            </form>
            <Link
              href="/analysis/new"
              className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
            >
              New analysis
            </Link>
            <Link
              href="/settings"
              className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50"
            >
              Settings
            </Link>
          </div>
        </header>

        {!hasLiveEngines && (
          <div className="mb-6 rounded-md border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-600">
            {hasGroq ? (
              <>
                Groq is configured, so a new (non-demo) analysis can generate a real profile, competitors, and
                prompts live. No measured-engine keys (ChatGPT/Claude/Gemini/Perplexity) are set yet, though, so the
                actual visibility run itself still needs the Hometap demo or a key added in{" "}
                <span className="font-mono">.env.local</span>.
              </>
            ) : (
              <>
                No AI provider keys are configured yet, so a new (non-demo) analysis can&apos;t run live prompts. Use
                the Hometap demo to see the full flow, or add a key in <span className="font-mono">.env.local</span>.
              </>
            )}
          </div>
        )}

        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
          {analyses.length === 0 ? (
            <p className="p-6 text-sm text-neutral-500">No analyses yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-4 py-2">Company</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Created</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {analyses.map((a) => (
                  <tr key={a.id} className="border-t border-neutral-100">
                    <td className="px-4 py-3 font-medium text-neutral-900">
                      {a.companyName}
                      {a.isDemo && (
                        <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-800">
                          Demo
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-neutral-600">{a.status}</td>
                    <td className="px-4 py-3 text-neutral-500">{a.createdAt.toISOString().slice(0, 10)}</td>
                    <td className="px-4 py-3 text-right">
                      <Link href={openHref(a)} className="text-sm font-semibold text-blue-600 hover:underline">
                        Open →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
