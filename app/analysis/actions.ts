"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import {
  createAnalysis,
  generateProfile,
  updateProfileFields,
  addCustomCompetitor,
  confirmProfile,
  generatePromptSetVersion,
  startOrResetHometapDemo,
  updatePromptText,
  deletePrompt,
  addPrompt,
  lockPromptSetVersion,
  startNewVersionForEditing,
  resolveBiasCheck,
} from "@/lib/analysisPipeline";
import { startRun, correctExtraction, type RunConfig } from "@/lib/runEngine";
import { restoreNewsArticle, runNewsScan, resumeFailedNewsQueries, WIDE_LOOKBACK_DAYS } from "@/lib/newsScan";
import { runJudgeAgreementCheck } from "@/lib/judgeAgreement";

export async function startHometapDemoAction() {
  const analysisId = await startOrResetHometapDemo();
  redirect(`/analysis/${analysisId}/profile`);
}

export async function createRealAnalysisAction(formData: FormData) {
  const companyName = String(formData.get("companyName") || "").trim();
  const companyUrl = String(formData.get("companyUrl") || "").trim() || undefined;
  const categoryHint = String(formData.get("categoryHint") || "").trim() || undefined;
  if (!companyName) throw new Error("Company name is required");

  const analysis = await createAnalysis({ companyName, companyUrl, categoryHint, isDemo: false });
  await generateProfile(analysis.id);
  redirect(`/analysis/${analysis.id}/profile`);
}

export async function updateProfileFieldsAction(analysisId: string, formData: FormData) {
  const description = String(formData.get("description") || "");
  const category = String(formData.get("category") || "");
  const audienceType = String(formData.get("audienceType") || "consumer");
  const icp = String(formData.get("icp") || "");
  const capabilities = String(formData.get("capabilities") || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const aliases = String(formData.get("aliases") || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  await updateProfileFields(analysisId, { description, category, audienceType, icp, capabilities, aliases });
  redirect(`/analysis/${analysisId}/competitors`);
}

export async function addCustomCompetitorAction(analysisId: string, formData: FormData) {
  const name = String(formData.get("newCompetitorName") || "").trim();
  const url = String(formData.get("newCompetitorUrl") || "").trim() || undefined;
  if (name) await addCustomCompetitor(analysisId, { name, url });
  revalidatePath(`/analysis/${analysisId}/competitors`);
}

export async function confirmCompetitorsAction(analysisId: string, formData: FormData) {
  const selectedNames = formData.getAll("competitor").map(String);
  const allSuggested: { name: string; url?: string }[] = JSON.parse(String(formData.get("allSuggested") || "[]"));
  const selectedCompetitors = allSuggested.filter((c) => selectedNames.includes(c.name)).map((c) => ({ name: c.name, url: c.url }));

  await confirmProfile(analysisId, { selectedCompetitors });
  await generatePromptSetVersion(analysisId);
  redirect(`/analysis/${analysisId}/prompts`);
}

export async function updatePromptAction(analysisId: string, promptId: string, formData: FormData) {
  const text = String(formData.get("text") || "").trim();
  const theme = String(formData.get("theme") || "").trim();
  if (text && theme) await updatePromptText(promptId, { text, theme });
  revalidatePath(`/analysis/${analysisId}/prompts`);
}

export async function deletePromptAction(analysisId: string, promptId: string) {
  await deletePrompt(promptId);
  revalidatePath(`/analysis/${analysisId}/prompts`);
}

export async function addPromptAction(analysisId: string, versionId: string, formData: FormData) {
  const text = String(formData.get("text") || "").trim();
  const theme = String(formData.get("theme") || "").trim();
  const branded = formData.get("branded") === "on";
  if (text && theme) await addPrompt(versionId, { text, theme, branded });
  revalidatePath(`/analysis/${analysisId}/prompts`);
}

export async function lockVersionAction(analysisId: string, versionId: string) {
  await lockPromptSetVersion(versionId);
  revalidatePath(`/analysis/${analysisId}/prompts`);
}

export async function unlockForEditingAction(analysisId: string) {
  await startNewVersionForEditing(analysisId);
  revalidatePath(`/analysis/${analysisId}/prompts`);
}

export async function resolveBiasCheckAction(analysisId: string, recordId: string, decision: "accept" | "override") {
  await resolveBiasCheck(recordId, decision);
  revalidatePath(`/analysis/${analysisId}/prompts`);
}

export async function previewRunAction(analysisId: string, formData: FormData) {
  const engines = formData.getAll("engines").map(String);
  const samples = String(formData.get("samples") || "1");
  const dual = formData.get("dual") === "1" ? "1" : "0";
  redirect(`/analysis/${analysisId}/run?engines=${encodeURIComponent(engines.join(","))}&samples=${samples}&dual=${dual}`);
}

export async function startRunAction(analysisId: string, config: RunConfig) {
  const snapshotId = await startRun(analysisId, config);
  redirect(`/analysis/${analysisId}/run/${snapshotId}`);
}

export async function correctExtractionAction(analysisId: string, snapshotId: string, responseId: string, formData: FormData) {
  const raw = String(formData.get("correctedJson") || "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Corrected brand mentions must be valid JSON");
  }
  await correctExtraction(responseId, parsed);
  revalidatePath(`/analysis/${analysisId}/run/${snapshotId}/review/${responseId}`);
}

export async function restoreNewsArticleAction(analysisId: string, snapshotId: string, articleId: string) {
  await restoreNewsArticle(articleId);
  revalidatePath(`/analysis/${analysisId}/run/${snapshotId}/news`);
}

export async function runJudgeAgreementCheckAction(analysisId: string, snapshotId: string) {
  await runJudgeAgreementCheck();
  revalidatePath(`/analysis/${analysisId}/run/${snapshotId}/review`);
}

export async function widenNewsSearchAction(analysisId: string, snapshotId: string) {
  await runNewsScan(snapshotId, { lookbackDays: WIDE_LOOKBACK_DAYS });
  await prisma.snapshot.update({ where: { id: snapshotId }, data: { status: "complete" } });
  revalidatePath(`/analysis/${analysisId}/run/${snapshotId}/news`);
}

export async function resumeFailedNewsQueriesAction(analysisId: string, snapshotId: string) {
  await resumeFailedNewsQueries(snapshotId);
  await prisma.snapshot.update({ where: { id: snapshotId }, data: { status: "complete" } });
  revalidatePath(`/analysis/${analysisId}/run/${snapshotId}/news`);
}

export async function confirmNewsScanCompleteAction(analysisId: string, snapshotId: string) {
  await prisma.snapshot.update({ where: { id: snapshotId }, data: { newsScanUserConfirmed: true } });
  revalidatePath(`/analysis/${analysisId}/run/${snapshotId}/news`);
}
