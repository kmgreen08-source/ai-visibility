"use server";

import { revalidatePath } from "next/cache";
import { setTaskConfig, type TaskName, type ReasoningProvider } from "@/lib/reasoningModel";

const TASKS: TaskName[] = ["profile", "competitorSuggestions", "promptGeneration", "biasCheck", "judge", "newsRelevance"];

export async function updateTaskModelsAction(formData: FormData) {
  for (const task of TASKS) {
    const provider = String(formData.get(`${task}_provider`) || "groq") as ReasoningProvider;
    const model = String(formData.get(`${task}_model`) || "").trim();
    if (model) await setTaskConfig(task, { provider, model });
  }
  revalidatePath("/settings");
}
