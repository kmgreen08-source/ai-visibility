// Metric formulas ported/generalized from the SEON GEO tracker prototype's
// renderSummary()/renderCompetitors(). Pure functions over plain rows so both
// a real run and demo-mode seed data can share one implementation.

export type MentionRow = {
  promptId: string;
  promptText: string;
  theme: string;
  branded: boolean;
  engine: string;
  brand: string;
  isTarget: boolean;
  rank: number;
  positioning: "leader" | "alternative" | "niche" | "secondary" | "mispositioned";
  sentiment: "positive" | "neutral" | "negative";
  ownDomainCited: boolean;
};

// One row per (prompt, engine) response that was actually run, regardless of
// whether the target brand was mentioned in it. Needed as the SOV denominator.
export type RunRow = {
  promptId: string;
  theme: string;
  branded: boolean;
  engine: string;
};

export type CitationRow = { domain: string };

function unbranded<T extends { branded: boolean }>(rows: T[]): T[] {
  return rows.filter((r) => !r.branded);
}

// % of unbranded (prompt, engine) runs where each brand is mentioned at all.
export function shareOfVoice(
  mentions: MentionRow[],
  runs: RunRow[],
  brands: string[]
): { brand: string; mentionedIn: number; totalRuns: number; pct: number }[] {
  const totalRuns = unbranded(runs).length;
  const unbrandedMentions = unbranded(mentions);
  return brands.map((brand) => {
    const mentionedRunKeys = new Set(
      unbrandedMentions
        .filter((m) => m.brand === brand)
        .map((m) => `${m.promptId}::${m.engine}`)
    );
    const mentionedIn = mentionedRunKeys.size;
    return {
      brand,
      mentionedIn,
      totalRuns,
      pct: totalRuns ? Math.round((100 * mentionedIn) / totalRuns) : 0,
    };
  });
}

export function averagePosition(mentions: MentionRow[], brand: string): number | null {
  const rows = unbranded(mentions).filter((m) => m.brand === brand);
  if (!rows.length) return null;
  return Math.round((10 * rows.reduce((s, r) => s + r.rank, 0)) / rows.length) / 10;
}

// % of a brand's mentions where its own domain was among the citations.
export function citationRate(mentions: MentionRow[], brand: string): { pct: number; citedOf: number; mentions: number } {
  const rows = unbranded(mentions).filter((m) => m.brand === brand);
  const citedOf = rows.filter((m) => m.ownDomainCited).length;
  return { pct: rows.length ? Math.round((100 * citedOf) / rows.length) : 0, citedOf, mentions: rows.length };
}

// theme x engine heatmap cell = mention rate for one brand.
export function visibilityHeatmap(
  mentions: MentionRow[],
  runs: RunRow[],
  brand: string
): { theme: string; engine: string; pct: number; runs: number }[] {
  const ur = unbranded(runs);
  const um = unbranded(mentions).filter((m) => m.brand === brand);
  const cells = new Map<string, { theme: string; engine: string; runs: number; mentioned: Set<string> }>();
  for (const r of ur) {
    const key = `${r.theme}::${r.engine}`;
    if (!cells.has(key)) cells.set(key, { theme: r.theme, engine: r.engine, runs: 0, mentioned: new Set() });
    cells.get(key)!.runs += 1;
  }
  for (const m of um) {
    const key = `${m.theme}::${m.engine}`;
    cells.get(key)?.mentioned.add(m.promptId);
  }
  return [...cells.values()].map((c) => ({
    theme: c.theme,
    engine: c.engine,
    runs: c.runs,
    pct: c.runs ? Math.round((100 * c.mentioned.size) / c.runs) : 0,
  }));
}

export function topCitedDomains(citations: CitationRow[], limit = 12): { domain: string; count: number }[] {
  const freq = new Map<string, number>();
  for (const c of citations) freq.set(c.domain, (freq.get(c.domain) ?? 0) + 1);
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([domain, count]) => ({ domain, count }));
}

// Unbranded prompts where at least one competitor is mentioned and the
// target brand is not — the credible "absence" signal per the brief.
export function gapPrompts(
  mentions: MentionRow[],
  runs: RunRow[],
  targetBrand: string
): { promptId: string; engine: string; competitorsMentioned: string[] }[] {
  const ur = unbranded(runs);
  const um = unbranded(mentions);
  const out: { promptId: string; engine: string; competitorsMentioned: string[] }[] = [];
  for (const r of ur) {
    const rowMentions = um.filter((m) => m.promptId === r.promptId && m.engine === r.engine);
    const targetMentioned = rowMentions.some((m) => m.isTarget);
    const competitors = rowMentions.filter((m) => !m.isTarget).map((m) => m.brand);
    if (!targetMentioned && competitors.length) {
      out.push({ promptId: r.promptId, engine: r.engine, competitorsMentioned: [...new Set(competitors)] });
    }
  }
  return out;
}
