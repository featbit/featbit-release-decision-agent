"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  createExperiment,
  deleteExperiment,
  updateExperiment,
  updateExperimentStage,
  addActivity,
  addMessage,
  updateExperimentRun,
} from "@/lib/data";

export async function createExperimentAction(formData: FormData) {
  const name = formData.get("name") as string;
  const description = formData.get("description") as string | null;

  if (!name || name.trim().length === 0) {
    throw new Error("Experiment name is required");
  }

  const experiment = await createExperiment({
    name: name.trim(),
    description: description?.trim() || undefined,
  });

  redirect(`/experiments/${experiment.id}`);
}

export async function deleteExperimentAction(id: string) {
  await deleteExperiment(id);
  redirect("/experiments");
}

export async function updateFlagConfigAction(formData: FormData) {
  const experimentId = formData.get("experimentId") as string;
  const flagKey = formData.get("flagKey") as string | null;
  const envSecret = formData.get("envSecret") as string | null;
  const accessToken = formData.get("accessToken") as string | null;
  const flagServerUrl = formData.get("flagServerUrl") as string | null;

  await updateExperiment(experimentId, {
    flagKey: flagKey?.trim() || null,
    envSecret: envSecret?.trim() || null,
    accessToken: accessToken?.trim() || null,
    flagServerUrl: flagServerUrl?.trim() || null,
  });

  await addActivity(experimentId, {
    type: "note",
    title: "Feature flag configuration updated",
  });

  revalidatePath(`/experiments/${experimentId}`);
}

export async function updateDecisionStateAction(formData: FormData) {
  const experimentId = formData.get("experimentId") as string;
  const goal = formData.get("goal") as string | null;
  const intent = formData.get("intent") as string | null;
  const hypothesis = formData.get("hypothesis") as string | null;
  const change = formData.get("change") as string | null;
  const primaryMetric = formData.get("primaryMetric") as string | null;
  const guardrails = formData.get("guardrails") as string | null;

  await updateExperiment(experimentId, {
    goal: goal?.trim() || null,
    intent: intent?.trim() || null,
    hypothesis: hypothesis?.trim() || null,
    change: change?.trim() || null,
    primaryMetric: primaryMetric?.trim() || null,
    guardrails: guardrails?.trim() || null,
  });

  await addActivity(experimentId, {
    type: "note",
    title: "Decision state updated",
  });

  revalidatePath(`/experiments/${experimentId}`);
}

export async function advanceStageAction(experimentId: string, stage: string) {
  await updateExperimentStage(experimentId, stage);
  revalidatePath(`/experiments/${experimentId}`);
}

export async function activateSandboxAction(experimentId: string) {
  // TODO: integrate with real sandbox API
  await updateExperiment(experimentId, {
    sandboxStatus: "running",
    sandboxId: `sandbox-${Date.now()}`,
  });

  await addActivity(experimentId, {
    type: "sandbox_event",
    title: "Sandbox activated",
    detail: "Remote Claude Code sandbox started for this experiment",
  });

  revalidatePath(`/experiments/${experimentId}`);
}

export async function sendMessageAction(experimentId: string, content: string) {
  if (!content || content.trim().length === 0) return;

  await addMessage(experimentId, {
    role: "user",
    content: content.trim(),
  });

  const experiment = await import("@/lib/data").then((m) =>
    m.getExperiment(experimentId)
  );

  await addMessage(experimentId, {
    role: "assistant",
    content: `I received your message. The experiment is currently in the **${experiment?.stage ?? "intent"}** stage. Agent integration is coming soon — I will be able to help you shape intent, design hypotheses, set up experiment runs, and analyze results.`,
  });

  await addActivity(experimentId, {
    type: "note",
    title: "Conversation message",
    detail: content.trim().slice(0, 120),
  });

  revalidatePath(`/experiments/${experimentId}`);
}

/**
 * Persist a user+assistant message pair from an SSE stream to the database.
 * Called by ChatPanel after each sandbox stream completes.
 * Best-effort — silently skips if experiment no longer exists.
 */
export async function persistMessagesAction(
  experimentId: string,
  userContent: string,
  assistantContent: string
) {
  try {
    const experiment = await import("@/lib/data").then((m) =>
      m.getExperiment(experimentId)
    );
    if (!experiment) return;

    if (userContent) {
      await addMessage(experimentId, { role: "user", content: userContent });
    }
    if (assistantContent) {
      await addMessage(experimentId, {
        role: "assistant",
        content: assistantContent,
      });
    }
    revalidatePath(`/experiments/${experimentId}`);
  } catch {
    // Persistence is best-effort — SSE chat works regardless
    console.warn(`[persistMessages] Failed for experiment ${experimentId}`);
  }
}

export async function updateExperimentRunAudienceAction(formData: FormData) {
  const experimentRunId = formData.get("experimentRunId") as string;
  const experimentId = formData.get("experimentId") as string;
  const trafficPercentRaw = formData.get("trafficPercent") as string;
  const trafficOffsetRaw = formData.get("trafficOffset") as string;
  const layerId = formData.get("layerId") as string | null;
  const audienceFilters = formData.get("audienceFilters") as string | null;
  const methodRaw = formData.get("method") as string | null;

  const trafficPercent = parseFloat(trafficPercentRaw);
  const trafficOffset = parseInt(trafficOffsetRaw, 10);
  const method = methodRaw === "bandit" ? "bandit" : "bayesian_ab";

  await updateExperimentRun(experimentRunId, {
    trafficPercent: isNaN(trafficPercent) ? 100 : Math.min(100, Math.max(1, trafficPercent)),
    trafficOffset: isNaN(trafficOffset) ? 0 : Math.min(99, Math.max(0, trafficOffset)),
    layerId: layerId?.trim() || null,
    audienceFilters: audienceFilters?.trim() || null,
    method,
  });

  await addActivity(experimentId, {
    type: "note",
    title: "Experiment run audience & traffic updated",
  });

  revalidatePath(`/experiments/${experimentId}`);
}
