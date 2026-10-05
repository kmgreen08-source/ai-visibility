// "Coverage gaps that shape AI answers" — cross-references the AI-visibility
// run against real, non-excluded news coverage from the same snapshot. Both
// halves come straight from the DB (ExtractedAnalysis for AI mentions,
// NewsArticle for press) — nothing here is synthesized text about a
// prompt/brand pair that didn't actually occur.
import { prisma } from "./db";

export type CoverageGap = {
  promptText: string;
  theme: string;
  totalRuns: number; // grounded, unbranded (prompt, engine) runs for this prompt
};

export type CoverageGapsSummary = {
  gaps: CoverageGap[]; // prompts where the target was mentioned in ZERO grounded, unbranded runs
  targetNewsCount: number;
  totalNewsCount: number;
  targetSharePct: number;
};

export async function computeCoverageGaps(snapshotId: string): Promise<CoverageGapsSummary> {
  const snapshot = await prisma.snapshot.findUniqueOrThrow({ where: { id: snapshotId }, include: { analysis: true } });
  const targetName = snapshot.analysis.companyName;

  const responses = await prisma.providerResponse.findMany({
    where: { snapshotId, status: "ok", mode: "grounded" },
    include: { prompt: true, extraction: true },
  });

  const byPrompt = new Map<string, { theme: string; text: string; total: number; mentioned: number }>();
  for (const r of responses) {
    if (r.prompt.branded) continue;
    if (!byPrompt.has(r.promptId)) byPrompt.set(r.promptId, { theme: r.prompt.theme, text: r.prompt.text, total: 0, mentioned: 0 });
    const entry = byPrompt.get(r.promptId)!;
    entry.total++;
    if (r.extraction) {
      const mentions: { brand: string }[] = JSON.parse(r.extraction.correctedBrandMentions ?? r.extraction.brandMentions);
      if (mentions.some((m) => m.brand === targetName)) entry.mentioned++;
    }
  }

  const gaps: CoverageGap[] = [...byPrompt.values()]
    .filter((e) => e.total > 0 && e.mentioned === 0)
    .map((e) => ({ promptText: e.text, theme: e.theme, totalRuns: e.total }))
    .sort((a, b) => a.theme.localeCompare(b.theme));

  const newsArticles = await prisma.newsArticle.findMany({ where: { snapshotId, excluded: false } });
  const targetNewsCount = newsArticles.filter((a) => a.brand === targetName).length;
  const totalNewsCount = newsArticles.length;
  const targetSharePct = totalNewsCount ? Math.round((100 * targetNewsCount) / totalNewsCount) : 0;

  return { gaps, targetNewsCount, totalNewsCount, targetSharePct };
}
