import { notFound } from "next/navigation";
import Link from "next/link";
import { getAnalysisWithProfile } from "@/lib/analysisPipeline";
import { DemoBanner } from "@/components/DemoBanner";
import { StepIndicator } from "@/components/StepIndicator";
import { SourceBadge } from "@/components/SourceBadge";
import { updateProfileFieldsAction } from "../../actions";

export default async function ProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const analysis = await getAnalysisWithProfile(id);
  if (!analysis || !analysis.profile) return notFound();

  const profile = analysis.profile;
  const capabilities: string[] = JSON.parse(profile.capabilities);
  const aliases: string[] = JSON.parse(profile.aliases);
  const sources: { url: string; title?: string }[] = profile.sources ? JSON.parse(profile.sources) : [];

  return (
    <div className="min-h-screen bg-neutral-50">
      {analysis.isDemo && <DemoBanner />}
      <div className="mx-auto max-w-3xl px-6 py-10">
        <Link href="/" className="text-sm text-neutral-500 hover:underline">
          ← Back to dashboard
        </Link>

        <header className="mt-2 mb-4">
          <StepIndicator current="Profile" />
          <h1 className="text-2xl font-bold text-neutral-900">{analysis.companyName}</h1>
          <p className="mt-1 text-sm text-neutral-500">Review and edit the profile below before moving on to competitors.</p>
        </header>

        {profile.profileGrounded ? (
          <div className="mb-6 rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900">
            <strong>Grounded in the company&apos;s own site.</strong> Built from the pages listed below, not model
            recall — still worth a skim, since site copy can be marketing-optimistic, but these aren&apos;t
            model-invented facts.
          </div>
        ) : (
          <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            <strong>Unverified — generated from model knowledge.</strong> The company&apos;s site couldn&apos;t be
            fetched, so this fell back to model recall with no live web access. Treat every fact below as a starting
            point to confirm, not a verified claim. Never trust a URL here unless you added it yourself.
          </div>
        )}

        <form action={updateProfileFieldsAction.bind(null, analysis.id)} className="space-y-6">
          <div className="rounded-lg border border-neutral-200 bg-white p-5">
            <h2 className="mb-4 flex items-center font-mono text-xs uppercase tracking-wide text-neutral-500">
              Profile
              <SourceBadge source={profile.profileSource} />
              {!profile.profileGrounded && (
                <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-amber-800">
                  unverified
                </span>
              )}
            </h2>
            <div className="space-y-4">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">Description</span>
                <textarea
                  name="description"
                  defaultValue={profile.description}
                  className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                  rows={2}
                />
              </label>
              <div className="grid grid-cols-2 gap-4">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">Category</span>
                  <input
                    name="category"
                    defaultValue={profile.category}
                    className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
                    Sells to
                  </span>
                  <select name="audienceType" defaultValue={profile.audienceType} className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm">
                    <option value="consumer">Consumers</option>
                    <option value="business">Businesses</option>
                  </select>
                </label>
              </div>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Ideal customer profile
                </span>
                <textarea
                  name="icp"
                  defaultValue={profile.icp}
                  className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                  rows={2}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Key capabilities (one per line)
                </span>
                <textarea
                  name="capabilities"
                  defaultValue={capabilities.join("\n")}
                  className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm font-mono"
                  rows={5}
                />
              </label>
              <label className="block">
                <span className="mb-1 flex items-center text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Known aliases / former / legal names (one per line, blank if none)
                  {!profile.aliasesVerified && aliases.length > 0 && (
                    <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-amber-800">
                      unverified — excluded from brand matching
                    </span>
                  )}
                </span>
                <textarea
                  name="aliases"
                  defaultValue={aliases.join("\n")}
                  placeholder="e.g. a legal entity name AI answers might use instead of the brand name"
                  className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm font-mono"
                  rows={2}
                />
                <p className="mt-1 text-xs text-neutral-400">
                  Editing this list counts as your own confirmation — saved aliases here are always used for brand
                  matching.
                </p>
              </label>
            </div>
          </div>

          {sources.length > 0 && (
            <div className="rounded-lg border border-neutral-200 bg-white p-5">
              <h2 className="mb-1 font-mono text-xs uppercase tracking-wide text-neutral-500">Sources fetched</h2>
              <p className="mb-3 text-sm text-neutral-500">
                {analysis.isDemo
                  ? "Demo mode doesn't fetch live — this list stands in for what a real fetch found, checked against these same pages when this demo was built."
                  : "Actually fetched from the company's own site and given to the model — not searched for or invented."}
              </p>
              <ul className="space-y-1.5">
                {sources.map((s) => (
                  <li key={s.url} className="text-sm">
                    <a href={s.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                      {s.title ?? s.url}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button className="rounded-md bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90">
            Continue to competitors →
          </button>
        </form>
      </div>
    </div>
  );
}
