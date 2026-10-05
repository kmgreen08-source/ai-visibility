// Orchestrates the new-analysis flow (profile -> confirm -> prompts),
// branching demo-vs-live internally so page/API code never has to. This is
// the "swap seeded data for live results with no UI changes" contract: every
// function here returns the same shape regardless of analysis.isDemo.
import { prisma } from "./db";
import { generateCompanyProfile, type CompanyProfileResult } from "./profile";
import { generatePromptSetWithBiasCheck } from "./promptGen";
import { DEMO_COMPANY, DEMO_COMPETITOR_SUGGESTIONS, DEMO_PROFILE_SOURCES, type CompetitorSuggestion } from "./demoCompany";
import { buildDemoPromptGeneration } from "./promptGenDemo";
import { checkPromptForBias, suggestRewrite, type PromptGenerationResult } from "./biasCheck";
import type { PromptSetVersion, Prompt } from "@prisma/client";

export async function createAnalysis(opts: {
  companyName: string;
  companyUrl?: string;
  categoryHint?: string;
  isDemo: boolean;
  createdBy?: string;
}) {
  return prisma.analysis.create({
    data: {
      companyName: opts.companyName,
      companyUrl: opts.companyUrl,
      categoryHint: opts.categoryHint,
      isDemo: opts.isDemo,
      createdBy: opts.createdBy,
      status: "profiling",
    },
  });
}

// "Start Hometap demo" reuses the existing demo analysis row rather than
// piling up duplicates on every click — resets its downstream data (profile,
// prompt set + versions cascade) and regenerates fresh.
export async function startOrResetHometapDemo(): Promise<string> {
  const existing = await prisma.analysis.findFirst({ where: { isDemo: true, companyName: DEMO_COMPANY.name } });

  let analysisId: string;
  if (existing) {
    await prisma.companyProfile.deleteMany({ where: { analysisId: existing.id } });
    await prisma.promptSet.deleteMany({ where: { analysisId: existing.id } }); // cascades to versions -> prompts
    await prisma.analysis.update({ where: { id: existing.id }, data: { status: "profiling" } });
    analysisId = existing.id;
  } else {
    const created = await createAnalysis({
      companyName: DEMO_COMPANY.name,
      companyUrl: DEMO_COMPANY.url,
      categoryHint: DEMO_COMPANY.category,
      isDemo: true,
    });
    analysisId = created.id;
  }

  await generateProfile(analysisId);
  return analysisId;
}

export async function generateProfile(analysisId: string) {
  const analysis = await prisma.analysis.findUniqueOrThrow({ where: { id: analysisId } });

  const profileData: CompanyProfileResult = analysis.isDemo
    ? {
        description: DEMO_COMPANY.description,
        category: DEMO_COMPANY.category,
        audienceType: DEMO_COMPANY.audienceType,
        icp: DEMO_COMPANY.icp,
        capabilities: DEMO_COMPANY.capabilities,
        aliases: DEMO_COMPANY.aliases,
        suggestedCompetitors: DEMO_COMPETITOR_SUGGESTIONS,
        sources: DEMO_PROFILE_SOURCES,
        profileSource: "heuristic",
        competitorsSource: "heuristic",
        // Demo facts were manually checked against Hometap's real site/news
        // when this dataset was built (see lib/demoCompany.ts) — that's the
        // same grounding guarantee an automated fetch would give.
        profileGrounded: true,
        competitorsGrounded: true,
        aliasesVerified: true,
      }
    : await generateCompanyProfile({
        companyName: analysis.companyName,
        companyUrl: analysis.companyUrl ?? undefined,
        categoryHint: analysis.categoryHint ?? undefined,
      });

  const data = {
    description: profileData.description,
    category: profileData.category,
    audienceType: profileData.audienceType,
    icp: profileData.icp,
    capabilities: JSON.stringify(profileData.capabilities),
    aliases: JSON.stringify(profileData.aliases),
    aliasesVerified: profileData.aliasesVerified,
    sources: JSON.stringify(profileData.sources),
    suggestedCompetitors: JSON.stringify(profileData.suggestedCompetitors),
    profileSource: profileData.profileSource,
    competitorsSource: profileData.competitorsSource,
    profileGrounded: profileData.profileGrounded,
    competitorsGrounded: profileData.competitorsGrounded,
  };

  return prisma.companyProfile.upsert({
    where: { analysisId },
    create: { analysisId, ...data, confirmedCompetitors: "[]" },
    update: data,
  });
}

// Appends a manually-added competitor to the suggestion list (shown as an
// extra, pre-checked "direct" row) — doesn't touch confirmedCompetitors,
// that only happens at confirmProfile.
export async function addCustomCompetitor(analysisId: string, opts: { name: string; url?: string }) {
  const profile = await prisma.companyProfile.findUniqueOrThrow({ where: { analysisId } });
  const suggested: CompetitorSuggestion[] = JSON.parse(profile.suggestedCompetitors);
  if (suggested.some((c) => c.name.toLowerCase() === opts.name.toLowerCase())) return profile;

  suggested.push({
    name: opts.name,
    url: opts.url ?? null,
    type: "direct",
    rationale: "Added manually by the agency user.",
    confidence: "medium",
    aliases: [],
    aliasesVerified: true, // manual entry — empty aliases array, nothing to verify
    discoverySource: "Added manually by the agency user",
  });

  return prisma.companyProfile.update({
    where: { analysisId },
    data: { suggestedCompetitors: JSON.stringify(suggested) },
  });
}

export async function updateProfileFields(
  analysisId: string,
  opts: { description: string; category: string; audienceType: string; icp: string; capabilities: string[]; aliases: string[] }
) {
  await prisma.companyProfile.update({
    where: { analysisId },
    data: {
      description: opts.description,
      category: opts.category,
      audienceType: opts.audienceType,
      icp: opts.icp,
      capabilities: JSON.stringify(opts.capabilities),
      aliases: JSON.stringify(opts.aliases),
      // A human reviewed and saved this form — that's the "or the user"
      // verification path, regardless of whether the original generation
      // was grounded.
      aliasesVerified: true,
    },
  });
}

export async function confirmProfile(analysisId: string, opts: { selectedCompetitors: { name: string; url?: string }[] }) {
  await prisma.companyProfile.update({
    where: { analysisId },
    data: { confirmedCompetitors: JSON.stringify(opts.selectedCompetitors) },
  });
  await prisma.promptSet.upsert({
    where: { analysisId },
    create: { analysisId },
    update: {},
  });
  await prisma.analysis.update({ where: { id: analysisId }, data: { status: "ready" } });
}

export async function generatePromptSetVersion(analysisId: string) {
  const analysis = await prisma.analysis.findUniqueOrThrow({
    where: { id: analysisId },
    include: {
      profile: true,
      promptSet: { include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } } },
    },
  });
  if (!analysis.profile) throw new Error("Profile must be confirmed before generating prompts");

  const competitors: { name: string; url?: string }[] = JSON.parse(analysis.profile.confirmedCompetitors);

  const result: PromptGenerationResult = analysis.isDemo
    ? buildDemoPromptGeneration()
    : await generatePromptSetWithBiasCheck({
        companyName: analysis.companyName,
        category: analysis.profile.category,
        icp: analysis.profile.icp,
        competitors: competitors.map((c) => c.name),
        audienceType: analysis.profile.audienceType as "consumer" | "business",
      });

  const promptSet = analysis.promptSet ?? (await prisma.promptSet.create({ data: { analysisId } }));
  const nextVersionNumber = (analysis.promptSet?.versions[0]?.versionNumber ?? 0) + 1;

  const version = await prisma.promptSetVersion.create({
    data: {
      promptSetId: promptSet.id,
      versionNumber: nextVersionNumber,
      competitorsSnapshot: JSON.stringify(competitors),
      changeNote: nextVersionNumber === 1 ? "Initial prompt set" : undefined,
      prompts: {
        create: result.prompts.map((p, i) => ({
          text: p.text,
          theme: p.theme,
          branded: p.branded,
          source: p.source,
          orderIndex: i,
        })),
      },
    },
    include: { prompts: { orderBy: { orderIndex: "asc" } } },
  });

  // Bias checks from bulk generation are auto-applied (Prompt.text already
  // holds the rewritten value) — record them as already-accepted history,
  // keyed to the real Prompt id now that rows exist (not the transient
  // generation-time "p3"/"pb6" staging id).
  const now = new Date();
  await prisma.biasCheckRecord.createMany({
    data: result.biasChecks.map((b) => {
      const stagingIndex = result.prompts.findIndex((p) => p.id === b.promptId);
      const realPrompt = version.prompts[stagingIndex];
      return {
        promptId: realPrompt.id,
        promptSetVersionId: version.id,
        original: b.original,
        rewritten: b.rewritten,
        reason: b.reason,
        explanation: b.explanation,
        status: "accepted",
        rewriteSource: b.rewriteSource,
        resolvedAt: now,
      };
    }),
  });

  await prisma.analysis.update({ where: { id: analysisId }, data: { status: "ready" } });

  return { version, biasChecks: result.biasChecks };
}

export async function getAnalysisWithProfile(analysisId: string) {
  return prisma.analysis.findUnique({ where: { id: analysisId }, include: { profile: true } });
}

export async function getLatestPromptSetVersion(analysisId: string) {
  const promptSet = await prisma.promptSet.findUnique({
    where: { analysisId },
    include: { versions: { orderBy: { versionNumber: "desc" }, take: 1, include: { prompts: { orderBy: { orderIndex: "asc" } } } } },
  });
  return promptSet?.versions[0] ?? null;
}

// Full bias-check history for one version, keyed by prompt id — "keep the
// full history" per the fix: nothing here is ever cleared by a later
// add/delete/edit of a *different* prompt (only cascade-deletes with its own
// prompt).
export async function getBiasCheckHistory(versionId: string) {
  return prisma.biasCheckRecord.findMany({ where: { promptSetVersionId: versionId }, orderBy: { createdAt: "asc" } });
}

// ---------------- Prompt editing (lock / version-clone on edit) ----------------

type VersionWithPrompts = PromptSetVersion & { prompts: Prompt[] };

async function getVersionWithPrompts(versionId: string): Promise<VersionWithPrompts> {
  return prisma.promptSetVersion.findUniqueOrThrow({
    where: { id: versionId },
    include: { prompts: { orderBy: { orderIndex: "asc" } } },
  });
}

// Bias-check context (target brand + competitors + category) for whichever
// analysis owns a given version — needed every time we check/rewrite an
// edited or added prompt.
async function getBiasContext(versionId: string): Promise<{ targetBrand: string; competitors: string[]; category: string }> {
  const version = await prisma.promptSetVersion.findUniqueOrThrow({
    where: { id: versionId },
    include: { promptSet: { include: { analysis: { include: { profile: true } } } } },
  });
  const profile = version.promptSet.analysis.profile;
  const competitors: { name: string }[] = profile ? JSON.parse(profile.confirmedCompetitors) : [];
  return {
    targetBrand: version.promptSet.analysis.companyName,
    competitors: competitors.map((c) => c.name),
    category: profile?.category ?? "",
  };
}

// Clones a version's prompts into a new, unlocked version (competitor
// snapshot carried over unchanged). Bias-check history stays attached to the
// OLD version's prompt rows (permanently preserved there); the new version's
// cloned prompts start with no history until they're themselves edited.
export async function cloneVersionUnlocked(oldVersionId: string, changeNote?: string): Promise<VersionWithPrompts> {
  const old = await getVersionWithPrompts(oldVersionId);
  const created = await prisma.promptSetVersion.create({
    data: {
      promptSetId: old.promptSetId,
      versionNumber: old.versionNumber + 1,
      competitorsSnapshot: old.competitorsSnapshot,
      changeNote: changeNote ?? "Edited from a locked version",
      locked: false,
      prompts: {
        create: old.prompts.map((p) => ({ text: p.text, theme: p.theme, branded: p.branded, orderIndex: p.orderIndex })),
      },
    },
    include: { prompts: { orderBy: { orderIndex: "asc" } } },
  });
  return created;
}

// Explicit "Edit prompt set (creates v2)" action for a locked version — no
// specific edit applied yet, just unlocks a fresh copy to work in.
export async function startNewVersionForEditing(analysisId: string): Promise<string> {
  const latest = await getLatestPromptSetVersion(analysisId);
  if (!latest) throw new Error("No prompt set version to edit");
  const cloned = await cloneVersionUnlocked(latest.id);
  return cloned.id;
}

export async function lockPromptSetVersion(versionId: string) {
  await prisma.promptSetVersion.update({ where: { id: versionId }, data: { locked: true } });
}

// Resolves a prompt-level edit target: if its version is locked, clones into
// a new unlocked version first and returns the corresponding cloned prompt
// (matched by orderIndex, which the clone preserves 1:1) instead — a safety
// net so these functions are correct even if called directly against a
// locked version, though the UI's primary path is the explicit unlock button.
async function resolveEditableTarget(promptId: string): Promise<{ versionId: string; promptId: string }> {
  const prompt = await prisma.prompt.findUniqueOrThrow({ where: { id: promptId } });
  const version = await prisma.promptSetVersion.findUniqueOrThrow({ where: { id: prompt.promptSetVersionId } });
  if (!version.locked) return { versionId: version.id, promptId: prompt.id };

  const cloned = await cloneVersionUnlocked(version.id);
  const clonedPrompt = cloned.prompts.find((p) => p.orderIndex === prompt.orderIndex);
  if (!clonedPrompt) throw new Error("Failed to resolve cloned prompt");
  return { versionId: cloned.id, promptId: clonedPrompt.id };
}

export type EditOutcome = { versionId: string; promptId: string; pendingBiasCheckId: string | null };

// Every added/edited prompt is bias-checked before it's considered "clean" —
// the text is saved immediately either way (so a user's typing is never
// lost), but a flagged prompt gets a "pending" BiasCheckRecord with a
// suggested rewrite that the UI surfaces inline until the user accepts it or
// explicitly overrides (keeps their own wording — recorded, not silently
// dropped).
export async function updatePromptText(promptId: string, opts: { text: string; theme: string }): Promise<EditOutcome> {
  const target = await resolveEditableTarget(promptId);
  await prisma.prompt.update({ where: { id: target.promptId }, data: { text: opts.text, theme: opts.theme, source: "manual" } });

  const ctx = await getBiasContext(target.versionId);
  const prompt = await prisma.prompt.findUniqueOrThrow({ where: { id: target.promptId } });
  const flag = checkPromptForBias(opts.text, { targetBrand: ctx.targetBrand, competitors: ctx.competitors, intendedBranded: prompt.branded });

  let pendingBiasCheckId: string | null = null;
  if (flag) {
    const { rewritten, source: rewriteSource } = await suggestRewrite(opts.text, flag.reason, ctx);
    const record = await prisma.biasCheckRecord.create({
      data: {
        promptId: target.promptId,
        promptSetVersionId: target.versionId,
        original: opts.text,
        rewritten,
        reason: flag.reason,
        explanation: flag.explanation,
        status: "pending",
        rewriteSource,
      },
    });
    pendingBiasCheckId = record.id;
  }

  return { versionId: target.versionId, promptId: target.promptId, pendingBiasCheckId };
}

export async function deletePrompt(promptId: string) {
  const target = await resolveEditableTarget(promptId);
  await prisma.prompt.delete({ where: { id: target.promptId } }); // cascades its own bias-check records only
  return target.versionId;
}

async function resolveEditableVersion(versionId: string): Promise<string> {
  const version = await prisma.promptSetVersion.findUniqueOrThrow({ where: { id: versionId } });
  if (!version.locked) return version.id;
  const cloned = await cloneVersionUnlocked(version.id);
  return cloned.id;
}

export async function addPrompt(versionId: string, opts: { text: string; theme: string; branded: boolean }): Promise<EditOutcome> {
  const targetVersionId = await resolveEditableVersion(versionId);
  const count = await prisma.prompt.count({ where: { promptSetVersionId: targetVersionId } });
  const created = await prisma.prompt.create({
    data: { promptSetVersionId: targetVersionId, text: opts.text, theme: opts.theme, branded: opts.branded, source: "manual", orderIndex: count },
  });

  const ctx = await getBiasContext(targetVersionId);
  const flag = checkPromptForBias(opts.text, { targetBrand: ctx.targetBrand, competitors: ctx.competitors, intendedBranded: opts.branded });

  let pendingBiasCheckId: string | null = null;
  if (flag) {
    const { rewritten, source: rewriteSource } = await suggestRewrite(opts.text, flag.reason, ctx);
    const record = await prisma.biasCheckRecord.create({
      data: {
        promptId: created.id,
        promptSetVersionId: targetVersionId,
        original: opts.text,
        rewritten,
        reason: flag.reason,
        explanation: flag.explanation,
        status: "pending",
        rewriteSource,
      },
    });
    pendingBiasCheckId = record.id;
  }

  return { versionId: targetVersionId, promptId: created.id, pendingBiasCheckId };
}

// User's decision on a pending bias-check flag. "accept" applies the
// suggested rewrite to the prompt; "override" keeps the user's own wording —
// either way the record is resolved, never deleted, so it stays in history.
export async function resolveBiasCheck(recordId: string, decision: "accept" | "override"): Promise<string> {
  const record = await prisma.biasCheckRecord.findUniqueOrThrow({ where: { id: recordId } });
  if (decision === "accept") {
    // The accepted text now reflects whatever produced the rewrite (groq or
    // heuristic), not the human's original wording — update source to match.
    await prisma.prompt.update({ where: { id: record.promptId }, data: { text: record.rewritten, source: record.rewriteSource } });
  }
  await prisma.biasCheckRecord.update({
    where: { id: recordId },
    data: { status: decision === "accept" ? "accepted" : "overridden", resolvedAt: new Date() },
  });
  return record.promptSetVersionId;
}
