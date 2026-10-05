import Link from "next/link";
import { hasAnyReasoningProviderConfigured } from "@/lib/reasoningModel";
import { createRealAnalysisAction } from "../actions";

export default function NewAnalysisPage() {
  // Profile/competitor/prompt generation only ever needs the Groq-style
  // reasoning model (see lib/reasoningModel.ts) — NOT a measured-engine key
  // (ChatGPT/Claude/Gemini/Perplexity). Those are only needed later, for the
  // actual visibility Run step, and that step already degrades gracefully
  // on its own if none are configured.
  const canGenerateProfile = hasAnyReasoningProviderConfigured();

  return (
    <div className="min-h-screen bg-neutral-50">
      <div className="mx-auto max-w-xl px-6 py-10">
        <Link href="/" className="text-sm text-neutral-500 hover:underline">
          ← Back
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-neutral-900">New analysis</h1>

        {!canGenerateProfile ? (
          <div className="mt-6 rounded-md border border-neutral-200 bg-white p-5 text-sm text-neutral-700">
            <p className="font-semibold text-neutral-900">No AI provider is configured yet.</p>
            <p className="mt-2">
              This step needs a live model call to research a real company — add <span className="font-mono">GROQ_API_KEY</span>{" "}
              (or another provider key) to <span className="font-mono">.env.local</span> first. In the meantime,{" "}
              <Link href="/" className="font-semibold text-blue-600 hover:underline">
                try the Hometap demo
              </Link>{" "}
              from the dashboard to see the full flow with seeded data.
            </p>
          </div>
        ) : (
          <form action={createRealAnalysisAction} className="mt-6 space-y-4 rounded-md border border-neutral-200 bg-white p-5">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">Company name</span>
              <input name="companyName" required className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Website (optional)
              </span>
              <input name="companyUrl" className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Category hint (optional)
              </span>
              <input name="categoryHint" className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm" />
            </label>
            <button className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
              Generate profile
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
