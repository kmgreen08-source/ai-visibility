import { prisma } from "../lib/db";
import { createAnalysis, generateProfile, confirmProfile, generatePromptSetVersion, getBiasCheckHistory } from "../lib/analysisPipeline";

async function main() {
  console.log("=== STEP 2 LIVE TEST: profile + competitor suggestions via Groq ===\n");

  const analysis = await createAnalysis({
    companyName: "Hometap",
    companyUrl: "hometap.com",
    categoryHint: "home equity investment",
    isDemo: false,
  });
  console.log("Created real analysis:", analysis.id);

  const t0 = Date.now();
  await generateProfile(analysis.id);
  console.log(`Profile generated in ${Date.now() - t0}ms\n`);

  const profile = await prisma.companyProfile.findUniqueOrThrow({ where: { analysisId: analysis.id } });
  console.log("--- Profile fields ---");
  console.log("description:", profile.description);
  console.log("category:", profile.category);
  console.log("icp:", profile.icp);
  console.log("capabilities:", JSON.parse(profile.capabilities));
  console.log("aliases:", JSON.parse(profile.aliases));
  console.log("profileSource:", profile.profileSource);
  console.log();
  console.log("--- Suggested competitors ---");
  const suggested = JSON.parse(profile.suggestedCompetitors);
  for (const c of suggested) console.log(JSON.stringify(c, null, 2));
  console.log("competitorsSource:", profile.competitorsSource);

  // Confirm the direct ones (mirrors what the UI would do by default) and generate prompts.
  const directCompetitors = suggested.filter((c: { type: string }) => c.type === "direct");
  await confirmProfile(analysis.id, { selectedCompetitors: directCompetitors.map((c: { name: string; url?: string }) => ({ name: c.name, url: c.url })) });

  console.log("\n\n=== STEP 2 LIVE TEST: prompt generation + bias check via Groq ===\n");
  const t1 = Date.now();
  const { version, biasChecks } = await generatePromptSetVersion(analysis.id);
  console.log(`Prompt set generated in ${Date.now() - t1}ms — ${version.prompts.length} prompts\n`);

  const unbranded = version.prompts.filter((p) => !p.branded);
  const branded = version.prompts.filter((p) => p.branded);
  console.log(`Unbranded: ${unbranded.length}, Branded: ${branded.length}`);
  const themes = [...new Set(unbranded.map((p) => p.theme))];
  console.log("Themes:", themes);
  console.log();
  for (const theme of themes) {
    console.log(`--- ${theme} ---`);
    for (const p of unbranded.filter((p) => p.theme === theme)) {
      console.log(`  [${p.source}] ${p.text}`);
    }
  }
  console.log("\n--- Branded ---");
  for (const p of branded) console.log(`  [${p.source}] ${p.text}`);

  console.log(`\n--- Bias checks caught: ${biasChecks.length} ---`);
  for (const b of biasChecks) {
    console.log(`\n[${b.reason}] (rewrite source: ${b.rewriteSource})`);
    console.log("  original:", b.original);
    console.log("  rewritten:", b.rewritten);
  }

  console.log("\n\nAnalysis id for follow-up inspection:", analysis.id);
}

main()
  .catch((e) => {
    console.error("TEST FAILED:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
