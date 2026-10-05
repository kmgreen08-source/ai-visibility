import { buildDemoDataset } from "../lib/demoData";
import { DEMO_COMPANY, DEMO_BRANDS } from "../lib/demoCompany";
import { shareOfVoice, averagePosition, citationRate, gapPrompts, topCitedDomains } from "../lib/metrics";

const ds = buildDemoDataset();
console.log(`prompts: ${ds.prompts.length}, runs: ${ds.runs.length}, mentions: ${ds.mentions.length}, citations: ${ds.citations.length}`);

console.log("\nShare of voice:");
console.table(shareOfVoice(ds.mentions, ds.runs, DEMO_BRANDS));

console.log(`\nAvg position (${DEMO_COMPANY.name}):`, averagePosition(ds.mentions, DEMO_COMPANY.name));
console.log(`Citation rate (${DEMO_COMPANY.name}):`, citationRate(ds.mentions, DEMO_COMPANY.name));

const gaps = gapPrompts(ds.mentions, ds.runs, DEMO_COMPANY.name);
console.log(`\nGap prompts (target absent, competitor present): ${gaps.length} of ${ds.runs.filter(r=>!r.branded).length} unbranded runs`);

console.log("\nTop cited domains:");
console.table(topCitedDomains(ds.citations));
