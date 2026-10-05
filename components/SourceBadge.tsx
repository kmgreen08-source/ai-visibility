const STYLE: Record<string, string> = {
  groq: "bg-emerald-100 text-emerald-800",
  openai: "bg-emerald-100 text-emerald-800",
  anthropic: "bg-emerald-100 text-emerald-800",
  heuristic: "bg-amber-100 text-amber-800",
  manual: "bg-blue-100 text-blue-800",
};

const LABEL: Record<string, string> = {
  groq: "Groq",
  openai: "OpenAI",
  anthropic: "Anthropic",
  heuristic: "Heuristic",
  manual: "Manual",
};

// Shown next to any value that could have come from a model, a no-key
// mechanical fallback, or a human — so a stale/unverified model guess is
// never mistaken for a verified fact.
export function SourceBadge({ source }: { source: string | null | undefined }) {
  if (!source) return null;
  return (
    <span className={`ml-2 rounded-full px-2 py-0.5 font-mono text-[10px] font-bold uppercase ${STYLE[source] ?? "bg-neutral-200 text-neutral-600"}`}>
      {LABEL[source] ?? source}
    </span>
  );
}
