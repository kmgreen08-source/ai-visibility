// Automated check: every brand the judge extracted must actually appear in
// the raw response text (by name or a known alias), and every tracked brand
// that's clearly named in the text must show up in the extraction. Applied
// to every extraction — ground truth (demo) and real judge output alike —
// so a hallucinated or dropped brand gets flagged for review instead of
// silently shipping as "the data."
export type TrackedBrandForCheck = { name: string; aliases: string[] };

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function nameOrAliasInText(text: string, brand: TrackedBrandForCheck): boolean {
  const candidates = [brand.name, ...brand.aliases];
  return candidates.some((c) => new RegExp(`(^|[^a-z0-9])${escapeRegex(c.toLowerCase())}($|[^a-z0-9])`, "i").test(text));
}

export function checkExtractionConsistency(
  rawText: string,
  extractedBrands: string[],
  trackedBrands: TrackedBrandForCheck[]
): string[] {
  const issues: string[] = [];

  for (const brand of extractedBrands) {
    const known = trackedBrands.find((b) => b.name === brand);
    const found = known ? nameOrAliasInText(rawText, known) : new RegExp(`(^|[^a-z0-9])${escapeRegex(brand.toLowerCase())}($|[^a-z0-9])`, "i").test(rawText);
    if (!found) {
      issues.push(`Extraction includes "${brand}" but it (or a known alias) doesn't appear in the raw text — possible hallucination.`);
    }
  }

  for (const brand of trackedBrands) {
    if (nameOrAliasInText(rawText, brand) && !extractedBrands.includes(brand.name)) {
      issues.push(`"${brand.name}" is named in the raw text but missing from the extraction — possible omission.`);
    }
  }

  return issues;
}
