import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { getLatestPromptSetVersion, getBiasCheckHistory } from "@/lib/analysisPipeline";
import { DemoBanner } from "@/components/DemoBanner";
import { StepIndicator } from "@/components/StepIndicator";
import { ALLOWED_CATEGORY_TERMS_NOTE } from "@/lib/biasCheck";
import { SourceBadge } from "@/components/SourceBadge";
import {
  updatePromptAction,
  deletePromptAction,
  addPromptAction,
  lockVersionAction,
  unlockForEditingAction,
  resolveBiasCheckAction,
} from "../../actions";

const REASON_LABEL: Record<string, string> = {
  brand_leak: "Names a brand in an unbranded prompt",
  product_jargon: "Uses proprietary/product jargon",
  leading_framing: "Presupposes the answer (leading)",
};

export default async function PromptsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const analysis = await prisma.analysis.findUnique({ where: { id } });
  if (!analysis) return notFound();

  const version = await getLatestPromptSetVersion(id);
  if (!version) return notFound();

  const biasHistory = await getBiasCheckHistory(version.id);
  const pendingByPrompt = new Map(biasHistory.filter((b) => b.status === "pending").map((b) => [b.promptId, b]));
  const resolvedByPrompt = new Map<string, typeof biasHistory>();
  for (const b of biasHistory) {
    if (b.status === "pending") continue;
    if (!resolvedByPrompt.has(b.promptId)) resolvedByPrompt.set(b.promptId, []);
    resolvedByPrompt.get(b.promptId)!.push(b);
  }

  const allPrompts = version.prompts;
  const unbranded = allPrompts.filter((p) => !p.branded);
  const branded = allPrompts.filter((p) => p.branded);
  const themes = [...new Set(unbranded.map((p) => p.theme))];
  const locked = version.locked;

  function PendingFlag({ record }: { record: (typeof biasHistory)[number] }) {
    return (
      <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-3">
        <span className="mb-1 inline-block rounded-full bg-amber-200 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-amber-900">
          {REASON_LABEL[record.reason] ?? record.reason}
        </span>
        <p className="text-xs text-amber-900/80">{record.explanation}</p>
        <p className="mt-1 text-sm font-medium text-emerald-700">
          Suggested: {record.rewritten}
          <SourceBadge source={record.rewriteSource} />
        </p>
        <div className="mt-2 flex gap-2">
          <form action={resolveBiasCheckAction.bind(null, id, record.id, "accept")}>
            <button className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:opacity-90">
              Use suggested rewrite
            </button>
          </form>
          <form action={resolveBiasCheckAction.bind(null, id, record.id, "override")}>
            <button className="rounded-md border border-neutral-300 bg-white px-3 py-1 text-xs font-semibold text-neutral-700 hover:bg-neutral-50">
              Keep as written
            </button>
          </form>
        </div>
      </div>
    );
  }

  function ResolvedTag({ promptId }: { promptId: string }) {
    const records = resolvedByPrompt.get(promptId);
    if (!records?.length) return null;
    const latest = records[records.length - 1];
    return latest.status === "accepted" ? (
      <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-emerald-700">
        rewritten
      </span>
    ) : (
      <span className="ml-2 rounded-full bg-neutral-200 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-neutral-600">
        flag overridden
      </span>
    );
  }

  function PromptRow({ p }: { p: (typeof allPrompts)[number] }) {
    const pending = pendingByPrompt.get(p.id);
    return (
      <li className="border-b border-neutral-100 pb-2 last:border-0">
        {locked ? (
          <p className="flex items-start gap-2 text-sm text-neutral-800">
            <span className="mt-1 h-1.5 w-1.5 flex-none rounded-full bg-neutral-300" />
            <span>
              {p.text}
              <SourceBadge source={p.source} />
              <ResolvedTag promptId={p.id} />
            </span>
          </p>
        ) : (
          <>
            <form action={updatePromptAction.bind(null, id, p.id)} className="flex flex-wrap items-center gap-2">
              <input name="text" defaultValue={p.text} className="min-w-[280px] flex-1 rounded-md border border-neutral-300 px-2 py-1 text-sm" />
              <select name="theme" defaultValue={p.theme} className="rounded-md border border-neutral-300 px-2 py-1 text-xs">
                {themes.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <button className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs font-semibold text-neutral-700 hover:bg-neutral-50">
                Save
              </button>
              <button
                formAction={deletePromptAction.bind(null, id, p.id)}
                className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-100"
              >
                Delete
              </button>
              <SourceBadge source={p.source} />
              <ResolvedTag promptId={p.id} />
            </form>
            {pending && <PendingFlag record={pending} />}
          </>
        )}
      </li>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      {analysis.isDemo && <DemoBanner />}
      <div className="mx-auto max-w-3xl px-6 py-10">
        <Link href={`/analysis/${id}/competitors`} className="text-sm text-neutral-500 hover:underline">
          ← Back to competitors
        </Link>

        <header className="mt-2 mb-4">
          <StepIndicator current="Prompts" />
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-neutral-900">{analysis.companyName}</h1>
            <span className={`rounded-full px-3 py-1 font-mono text-xs font-bold uppercase ${locked ? "bg-neutral-800 text-white" : "bg-amber-100 text-amber-800"}`}>
              v{version.versionNumber} · {locked ? "locked" : "editable"}
            </span>
          </div>
          <p className="mt-1 text-sm text-neutral-500">
            {unbranded.length} unbranded prompts across {themes.length} themes, plus {branded.length} branded prompts
            tracked separately and excluded from headline metrics.
          </p>
        </header>

        <div className="mb-6">
          {locked ? (
            <form action={unlockForEditingAction.bind(null, id)}>
              <button className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50">
                Edit prompt set (creates v{version.versionNumber + 1}) →
              </button>
            </form>
          ) : (
            <form action={lockVersionAction.bind(null, id, version.id)}>
              <button className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
                Lock prompt set (v{version.versionNumber})
              </button>
              <span className="ml-3 text-xs text-neutral-500">
                Locking makes it read-only for comparable re-runs — runs can only execute against a locked version. Any later change creates v{version.versionNumber + 1}.
              </span>
            </form>
          )}
        </div>

        <div className={`mb-6 rounded-lg border p-5 ${biasHistory.length > 0 ? "border-amber-300 bg-amber-50" : "border-emerald-300 bg-emerald-50"}`}>
          <h2 className={`mb-1 font-mono text-xs uppercase tracking-wide ${biasHistory.length > 0 ? "text-amber-800" : "text-emerald-800"}`}>
            Bias-check history — {biasHistory.length} flag{biasHistory.length !== 1 ? "s" : ""} on this version
          </h2>
          <p className={`mb-2 text-sm ${biasHistory.length > 0 ? "text-amber-900/80" : "text-emerald-900/80"}`}>
            {biasHistory.length > 0
              ? "Every generated, added, or edited prompt is checked. Flags stay tied to the specific prompt permanently — editing or deleting a different prompt never clears this list."
              : "Every generated, added, or edited prompt is checked — this run came back clean, which is shown here explicitly rather than just hiding the panel."}
          </p>
          <p className={`mb-4 text-xs ${biasHistory.length > 0 ? "text-amber-900/60" : "text-emerald-900/60"}`}>{ALLOWED_CATEGORY_TERMS_NOTE}</p>
          {biasHistory.length > 0 && (
            <div className="space-y-3">
              {biasHistory.map((b) => (
                <div key={b.id} className="rounded-md border border-amber-200 bg-white p-3">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="inline-block rounded-full bg-amber-200 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-amber-900">
                      {REASON_LABEL[b.reason] ?? b.reason}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-bold uppercase ${
                        b.status === "pending"
                          ? "bg-amber-400 text-amber-950"
                          : b.status === "accepted"
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-neutral-200 text-neutral-600"
                      }`}
                    >
                      {b.status}
                    </span>
                  </div>
                  <p className="text-sm text-neutral-500 line-through decoration-red-400">{b.original}</p>
                  <p className="text-sm font-medium text-emerald-700">→ {b.rewritten}</p>
                  <p className="mt-1 text-xs text-neutral-500">{b.explanation}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-6">
          {themes.map((theme) => (
            <div key={theme} className="rounded-lg border border-neutral-200 bg-white p-5">
              <h2 className="mb-3 font-mono text-xs uppercase tracking-wide text-neutral-500">{theme}</h2>
              <ul className="space-y-3">
                {unbranded.filter((p) => p.theme === theme).map((p) => (
                  <PromptRow key={p.id} p={p} />
                ))}
              </ul>

              {!locked && (
                <form action={addPromptAction.bind(null, id, version.id)} className="mt-3 flex flex-wrap items-center gap-2 border-t border-dashed border-neutral-200 pt-3">
                  <input type="hidden" name="theme" value={theme} />
                  <input name="text" placeholder="Add a prompt to this theme…" className="min-w-[280px] flex-1 rounded-md border border-neutral-300 px-2 py-1 text-sm" />
                  <button className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs font-semibold text-neutral-700 hover:bg-neutral-50">
                    Add
                  </button>
                </form>
              )}
            </div>
          ))}

          <div className="rounded-lg border border-dashed border-neutral-300 bg-white p-5">
            <h2 className="mb-1 font-mono text-xs uppercase tracking-wide text-neutral-500">
              Branded prompts — secondary set, excluded from headline metrics
            </h2>
            <ul className="mt-3 space-y-3">
              {branded.map((p) => (
                <PromptRow key={p.id} p={p} />
              ))}
            </ul>

            {!locked && (
              <form action={addPromptAction.bind(null, id, version.id)} className="mt-3 flex flex-wrap items-center gap-2 border-t border-dashed border-neutral-200 pt-3">
                <input type="hidden" name="theme" value="Comparison/evaluation" />
                <input type="hidden" name="branded" value="on" />
                <input name="text" placeholder="Add a branded prompt…" className="min-w-[280px] flex-1 rounded-md border border-neutral-300 px-2 py-1 text-sm" />
                <button className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs font-semibold text-neutral-700 hover:bg-neutral-50">
                  Add
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
