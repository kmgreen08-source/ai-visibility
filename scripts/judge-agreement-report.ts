// CLI wrapper around lib/judgeAgreement.ts — the app itself exposes the same
// check as a "Judge quality" panel (persisted, re-runnable against whatever
// judge model is currently configured). This script is the quick way to see
// the numbers from a terminal without opening the UI.
import { prisma } from "../lib/db";
import { runJudgeAgreementCheck } from "../lib/judgeAgreement";

async function main() {
  console.log("Testing judge agreement against the demo's seeded ground truth (calls Groq once per fixture — takes a few minutes)...\n");
  const report = await runJudgeAgreementCheck();

  console.log(`=== Judge agreement report (${report.judgeProvider}/${report.judgeModel}, ${report.fixturesTested} fixtures) ===`);
  console.log("Brand set match:", `${report.brandSetMatchPct}%`);
  console.log("Order/rank match:", `${report.orderMatchPct}%`);
  console.log("Positioning match:", `${report.positioningMatchPct}%`);
  console.log("Sentiment match:", `${report.sentimentMatchPct}%`);
  console.log("Citation match:", `${report.citationMatchPct}%`);
  console.log(`Consistency-check failures: ${report.consistencyFailures}/${report.fixturesTested}`);
  console.log(`Judge self-flagged: ${report.judgeSelfFlagged}/${report.fixturesTested}`);

  if (report.disagreementExamples.length > 0) {
    console.log("\n--- Example disagreements ---");
    for (const ex of report.disagreementExamples) console.log(" -", ex);
  }
}

main()
  .catch((e) => {
    console.error("REPORT FAILED:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
