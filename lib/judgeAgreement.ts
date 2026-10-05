// Runs the REAL, currently-configured judge model against every demo
// fixture and compares it to the seeded ground truth, per field. This never
// writes to ExtractedAnalysis or changes what the app displays for the demo
// (that always stays ground truth — see lib/runEngine.ts); its only job is
// answering "how much do we trust the judge," recorded as a row so it can be
// re-run later against a different configured model and compared.
import { prisma } from "./db";
import { buildDemoRunFixtures, groundTruthExtraction, DEMO_SIMULATED_FAILURE } from "./demoRunFixtures";
import { judgeResponse } from "./judge";
import { checkExtractionConsistency } from "./consistencyCheck";
import { DEMO_BRANDS } from "./demoCompany";
import { getTaskConfig } from "./reasoningModel";

type FieldTally = { total: number; match: number };

function tally(t: FieldTally, isMatch: boolean) {
  t.total++;
  if (isMatch) t.match++;
}

function pct(t: FieldTally): number {
  return t.total ? Math.round((100 * t.match) / t.total) : 0;
}

export type JudgeAgreementSummary = {
  id: string;
  createdAt: Date;
  judgeProvider: string;
  judgeModel: string;
  fixturesTested: number;
  brandSetMatchPct: number;
  orderMatchPct: number;
  positioningMatchPct: number;
  sentimentMatchPct: number;
  citationMatchPct: number;
  consistencyFailures: number;
  judgeSelfFlagged: number;
  disagreementExamples: string[];
};

export async function runJudgeAgreementCheck(): Promise<JudgeAgreementSummary> {
  const { provider, model } = await getTaskConfig("judge");
  const fixtures = buildDemoRunFixtures();
  const trackedBrands = DEMO_BRANDS.map((name) => ({ name, aliases: [] as string[] }));

  const brandSetTally: FieldTally = { total: 0, match: 0 };
  const orderTally: FieldTally = { total: 0, match: 0 };
  const positioningTally: FieldTally = { total: 0, match: 0 };
  const sentimentTally: FieldTally = { total: 0, match: 0 };
  const citationTally: FieldTally = { total: 0, match: 0 };
  let consistencyFailures = 0;
  let judgeFlagged = 0;
  let tested = 0;
  const disagreementExamples: string[] = [];

  const entries = [...fixtures.entries()].filter(([key]) => {
    const [stagingId, engine] = key.split("::");
    return !(stagingId === DEMO_SIMULATED_FAILURE.promptId && engine === DEMO_SIMULATED_FAILURE.engine);
  });

  for (const [key, fixture] of entries) {
    tested++;
    const truth = groundTruthExtraction(fixture.mentions);
    const truthBrands = new Set(truth.brandMentions.map((b) => b.brand));

    const result = await judgeResponse({ responseText: fixture.rawText, citations: fixture.citations, trackedBrands });
    if (result.flaggedForReview) judgeFlagged++;

    const judgeBrands = new Set(result.extraction.brandMentions.map((b) => b.brand));
    const brandSetMatches = truthBrands.size === judgeBrands.size && [...truthBrands].every((b) => judgeBrands.has(b));
    tally(brandSetTally, brandSetMatches);

    for (const truthMention of truth.brandMentions) {
      const judgeMention = result.extraction.brandMentions.find((b) => b.brand === truthMention.brand);
      if (!judgeMention) continue; // counted in brandSetTally already
      tally(orderTally, judgeMention.rank === truthMention.rank);
      tally(positioningTally, judgeMention.positioning === truthMention.positioning);
      tally(sentimentTally, judgeMention.sentiment === truthMention.sentiment);
      tally(citationTally, judgeMention.ownDomainCited === truthMention.ownDomainCited);
    }

    const issues = checkExtractionConsistency(fixture.rawText, [...judgeBrands], trackedBrands);
    if (issues.length > 0) {
      consistencyFailures++;
      if (disagreementExamples.length < 8) disagreementExamples.push(`${key}: ${issues.join(" | ")}`);
    }
    if (!brandSetMatches && disagreementExamples.length < 8) {
      disagreementExamples.push(`${key}: ground truth brands [${[...truthBrands].join(", ")}] vs judge [${[...judgeBrands].join(", ")}]`);
    }
  }

  const report = await prisma.judgeAgreementReport.create({
    data: {
      judgeProvider: provider,
      judgeModel: model,
      fixturesTested: tested,
      brandSetMatchPct: pct(brandSetTally),
      orderMatchPct: pct(orderTally),
      positioningMatchPct: pct(positioningTally),
      sentimentMatchPct: pct(sentimentTally),
      citationMatchPct: pct(citationTally),
      consistencyFailures,
      judgeSelfFlagged: judgeFlagged,
      disagreementExamples: JSON.stringify(disagreementExamples),
    },
  });

  return toSummary(report);
}

function toSummary(report: {
  id: string;
  createdAt: Date;
  judgeProvider: string;
  judgeModel: string;
  fixturesTested: number;
  brandSetMatchPct: number;
  orderMatchPct: number;
  positioningMatchPct: number;
  sentimentMatchPct: number;
  citationMatchPct: number;
  consistencyFailures: number;
  judgeSelfFlagged: number;
  disagreementExamples: string;
}): JudgeAgreementSummary {
  return { ...report, disagreementExamples: JSON.parse(report.disagreementExamples) };
}

export async function getLatestJudgeAgreementReport(): Promise<JudgeAgreementSummary | null> {
  const report = await prisma.judgeAgreementReport.findFirst({ orderBy: { createdAt: "desc" } });
  return report ? toSummary(report) : null;
}
