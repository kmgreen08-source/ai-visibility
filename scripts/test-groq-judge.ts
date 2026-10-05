import { prisma } from "../lib/db";
import { buildDemoRunFixtures, groundTruthExtraction } from "../lib/demoRunFixtures";
import { judgeResponse } from "../lib/judge";
import { DEMO_BRANDS } from "../lib/demoCompany";

async function main() {
  const fixtures = buildDemoRunFixtures();

  // Pick a handful of interesting cases: the forced mispositioning case,
  // a gap prompt (competitor present, Hometap absent), and a couple of
  // ordinary ones — enough to sanity-check the real judge without burning
  // a big chunk of free-tier quota on a full ~100-call run.
  const keysToTest = ["p5::gemini", "p1::openai", "p9::perplexity", "p14::anthropic"];

  const trackedBrands = DEMO_BRANDS.map((name) => ({ name, aliases: [] }));

  for (const key of keysToTest) {
    const fixture = fixtures.get(key);
    if (!fixture) {
      console.log(`\n=== ${key}: NO FIXTURE ===`);
      continue;
    }
    console.log(`\n=== ${key} ===`);
    console.log("RAW TEXT:\n" + fixture.rawText);
    console.log("\nGROUND TRUTH:");
    console.log(JSON.stringify(groundTruthExtraction(fixture.mentions).brandMentions, null, 2));

    const t0 = Date.now();
    const result = await judgeResponse({
      responseText: fixture.rawText,
      citations: fixture.citations,
      trackedBrands,
    });
    console.log(`\nREAL GROQ JUDGE (${Date.now() - t0}ms, source: ${result.judgeSource}, model: ${result.judgeModel}, retried: ${result.wasRetried}, flagged: ${result.flaggedForReview}):`);
    console.log(JSON.stringify(result.extraction.brandMentions, null, 2));
    if (result.extraction.otherBrandsMentioned.length) {
      console.log("Other brands mentioned:", result.extraction.otherBrandsMentioned);
    }
  }
}

main()
  .catch((e) => {
    console.error("TEST FAILED:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
