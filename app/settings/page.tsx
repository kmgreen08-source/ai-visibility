import Link from "next/link";
import { getAllTaskConfigs, type TaskName } from "@/lib/reasoningModel";
import { updateTaskModelsAction } from "./actions";

const TASK_LABEL: Record<TaskName, string> = {
  profile: "Company profile",
  competitorSuggestions: "Competitor suggestions",
  promptGeneration: "Prompt generation",
  biasCheck: "Bias-check rewrites",
  judge: "LLM-as-judge extraction",
  newsRelevance: "News article classification — mention type, sentiment, topic (Step 4)",
};

export default async function SettingsPage() {
  const configs = await getAllTaskConfigs();

  return (
    <div className="min-h-screen bg-neutral-50">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <Link href="/" className="text-sm text-neutral-500 hover:underline">
          ← Back to dashboard
        </Link>
        <h1 className="mt-2 mb-1 text-2xl font-bold text-neutral-900">Settings</h1>
        <p className="mb-6 text-sm text-neutral-500">
          Which model powers each internal reasoning task. These are never the measured AI-visibility engines
          (ChatGPT/Claude/Gemini/Perplexity) — those stay on their own keys in <span className="font-mono">.env.local</span>.
          Changing a task here takes effect immediately, no redeploy.
        </p>

        <form action={updateTaskModelsAction} className="space-y-3 rounded-lg border border-neutral-200 bg-white p-5">
          {(Object.keys(TASK_LABEL) as TaskName[]).map((task) => (
            <div key={task} className="flex flex-wrap items-center gap-2 border-b border-neutral-100 pb-3 last:border-0">
              <span className="w-64 text-sm text-neutral-700">{TASK_LABEL[task]}</span>
              <select name={`${task}_provider`} defaultValue={configs[task].provider} className="rounded-md border border-neutral-300 px-2 py-1 text-xs">
                <option value="groq">Groq</option>
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
              </select>
              <input
                name={`${task}_model`}
                defaultValue={configs[task].model}
                className="min-w-[220px] flex-1 rounded-md border border-neutral-300 px-2 py-1 font-mono text-xs"
              />
            </div>
          ))}
          <button className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
            Save
          </button>
        </form>

        <p className="mt-4 text-xs text-neutral-400">
          Groq free/developer tier currently supports openai/gpt-oss-120b and openai/gpt-oss-20b as the strong
          open-weight options — Llama 3.1/3.3 moved to enterprise-only pricing, so they're not usable here without a
          paid contract.
        </p>
      </div>
    </div>
  );
}
