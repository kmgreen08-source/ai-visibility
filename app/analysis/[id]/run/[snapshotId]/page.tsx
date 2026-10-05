import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { DemoBanner } from "@/components/DemoBanner";
import { StepIndicator } from "@/components/StepIndicator";
import { RunProgress } from "@/components/RunProgress";

export default async function RunProgressPage({ params }: { params: Promise<{ id: string; snapshotId: string }> }) {
  const { id, snapshotId } = await params;
  const analysis = await prisma.analysis.findUnique({ where: { id } });
  const snapshot = await prisma.snapshot.findUnique({ where: { id: snapshotId } });
  if (!analysis || !snapshot) return notFound();

  return (
    <div className="min-h-screen bg-neutral-50">
      {analysis.isDemo && <DemoBanner />}
      <div className="mx-auto max-w-2xl px-6 py-10">
        <StepIndicator current="Run" />
        <h1 className="mb-1 text-2xl font-bold text-neutral-900">{analysis.companyName}</h1>
        <p className="mb-6 text-sm text-neutral-500">
          Run #{snapshot.runNumber} — {JSON.parse(snapshot.engines).join(", ")}, {snapshot.samplesPerPrompt} sample
          {snapshot.samplesPerPrompt !== 1 ? "s" : ""}/prompt{snapshot.dualMode ? ", dual mode" : ""}.
        </p>
        <RunProgress snapshotId={snapshotId} reviewHref={`/analysis/${id}/run/${snapshotId}/review`} />
      </div>
    </div>
  );
}
