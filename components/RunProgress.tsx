"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Progress = { status: string; total: number; ok: number; error: number; done: number };

export function RunProgress({ snapshotId, reviewHref }: { snapshotId: string; reviewHref: string }) {
  const [progress, setProgress] = useState<Progress | null>(null);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/snapshots/${snapshotId}/status`, { cache: "no-store" });
        const data: Progress = await res.json();
        if (cancelled) return;
        setProgress(data);
        if (data.status === "complete" || data.status === "complete_with_errors" || data.status === "failed") {
          setTimeout(() => router.push(reviewHref), 800);
          return;
        }
      } catch {
        // transient — next tick retries
      }
      if (!cancelled) setTimeout(poll, 800);
    };
    poll();
    return () => {
      cancelled = true;
    };
  }, [snapshotId, reviewHref, router]);

  const pct = progress && progress.total > 0 ? Math.round((100 * progress.done) / progress.total) : 0;

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-6">
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="font-mono uppercase tracking-wide text-neutral-500">{progress?.status ?? "starting…"}</span>
        <span className="font-mono text-neutral-900">
          {progress ? `${progress.done} / ${progress.total}` : "…"}
        </span>
      </div>
      <div className="h-3 w-full overflow-hidden rounded-full bg-neutral-100">
        <div className="h-full bg-neutral-900 transition-all" style={{ width: `${pct}%` }} />
      </div>
      {progress && progress.error > 0 && (
        <p className="mt-3 text-sm text-amber-700">
          {progress.error} call{progress.error !== 1 ? "s" : ""} failed after retries — the run continues with partial
          results.
        </p>
      )}
      {progress && (progress.status === "complete" || progress.status === "complete_with_errors") && (
        <p className="mt-3 text-sm text-emerald-700">Done — opening results…</p>
      )}
    </div>
  );
}
