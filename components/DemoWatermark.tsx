// Reusable watermark for demo-mode charts and exports. Renders as a diagonal
// corner ribbon so it survives being screenshotted or exported to PNG/PDF —
// per the labeling rule, this has no "hide" prop and is not conditional on
// anything except isDemo, so a demo report can never be shared without it.
export function DemoWatermark({ label = "DEMO DATA" }: { label?: string }) {
  return (
    <div
      className="pointer-events-none absolute right-0 top-0 overflow-hidden"
      style={{ width: 120, height: 120 }}
      aria-hidden
    >
      <div
        className="absolute select-none bg-amber-400/90 py-1 text-center text-[10px] font-bold uppercase tracking-wider text-amber-950 shadow"
        style={{ width: 170, right: -40, top: 22, transform: "rotate(45deg)" }}
      >
        {label}
      </div>
    </div>
  );
}
