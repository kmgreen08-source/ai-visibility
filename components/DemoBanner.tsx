// Persistent, unmissable marker for any demo-mode analysis — required per the
// labeling rules: demo data must never be mistakable for a live result.
export function DemoBanner() {
  return (
    <div className="sticky top-0 z-50 flex items-center justify-center gap-2 bg-amber-400 px-4 py-2 text-sm font-semibold text-amber-950">
      <span aria-hidden>◆</span>
      Demo data — illustrative only. Not a live analysis of a real AI run.
    </div>
  );
}
