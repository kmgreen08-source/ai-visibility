// Stage labels for the new-analysis flow — deliberately not "Step 2/3" etc,
// since those numbers collide with the unrelated build-order steps used to
// plan this app itself.
const STAGES = ["Profile", "Competitors", "Prompts", "Run"] as const;
export type Stage = (typeof STAGES)[number];

export function StepIndicator({ current }: { current: Stage }) {
  const currentIndex = STAGES.indexOf(current);
  return (
    <div className="mb-6 flex items-center gap-2 font-mono text-xs uppercase tracking-wide">
      {STAGES.map((stage, i) => {
        const isCurrent = stage === current;
        const isDone = i < currentIndex;
        return (
          <div key={stage} className="flex items-center gap-2">
            {i > 0 && <span className="text-neutral-300">→</span>}
            <span className={isCurrent ? "font-bold text-neutral-900" : isDone ? "text-emerald-600" : "text-neutral-400"}>
              {stage}
            </span>
          </div>
        );
      })}
    </div>
  );
}
