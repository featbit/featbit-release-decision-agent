"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  createProject,
  deleteProject,
  updateProject,
  updateProjectStage,
  addActivity,
  addMessage,
} from "@/lib/data";

export async function createProjectAction(formData: FormData) {
  const name = formData.get("name") as string;
  const description = formData.get("description") as string | null;

  if (!name || name.trim().length === 0) {
    throw new Error("Project name is required");
  }

  const project = await createProject({
    name: name.trim(),
    description: description?.trim() || undefined,
  });

  redirect(`/projects/${project.id}`);
}

export async function deleteProjectAction(id: string) {
  await deleteProject(id);
  redirect("/projects");
}

export async function updateFlagConfigAction(formData: FormData) {
  const projectId = formData.get("projectId") as string;
  const flagKey = formData.get("flagKey") as string | null;
  const envSecret = formData.get("envSecret") as string | null;
  const accessToken = formData.get("accessToken") as string | null;
  const flagServerUrl = formData.get("flagServerUrl") as string | null;

  await updateProject(projectId, {
    flagKey: flagKey?.trim() || null,
    envSecret: envSecret?.trim() || null,
    accessToken: accessToken?.trim() || null,
    flagServerUrl: flagServerUrl?.trim() || null,
  });

  await addActivity(projectId, {
    type: "note",
    title: "Feature flag configuration updated",
  });

  revalidatePath(`/projects/${projectId}`);
}

export async function updateDecisionStateAction(formData: FormData) {
  const projectId = formData.get("projectId") as string;
  const goal = formData.get("goal") as string | null;
  const intent = formData.get("intent") as string | null;
  const hypothesis = formData.get("hypothesis") as string | null;
  const change = formData.get("change") as string | null;
  const primaryMetric = formData.get("primaryMetric") as string | null;
  const guardrails = formData.get("guardrails") as string | null;

  await updateProject(projectId, {
    goal: goal?.trim() || null,
    intent: intent?.trim() || null,
    hypothesis: hypothesis?.trim() || null,
    change: change?.trim() || null,
    primaryMetric: primaryMetric?.trim() || null,
    guardrails: guardrails?.trim() || null,
  });

  await addActivity(projectId, {
    type: "note",
    title: "Decision state updated",
  });

  revalidatePath(`/projects/${projectId}`);
}

export async function advanceStageAction(projectId: string, stage: string) {
  await updateProjectStage(projectId, stage);
  revalidatePath(`/projects/${projectId}`);
}

export async function activateSandboxAction(projectId: string) {
  // TODO: integrate with real sandbox API
  await updateProject(projectId, {
    sandboxStatus: "running",
    sandboxId: `sandbox-${Date.now()}`,
  });

  await addActivity(projectId, {
    type: "sandbox_event",
    title: "Sandbox activated",
    detail: "Remote Claude Code sandbox started for this project",
  });

  revalidatePath(`/projects/${projectId}`);
}

export async function sendMessageAction(projectId: string, content: string) {
  if (!content || content.trim().length === 0) return;

  // Store user message
  await addMessage(projectId, {
    role: "user",
    content: content.trim(),
  });

  // TODO: Forward to sandbox agent and stream response.
  // For now, create a placeholder assistant reply.
  const project = await import("@/lib/data").then((m) =>
    m.getProject(projectId)
  );

  await addMessage(projectId, {
    role: "assistant",
    content: `I received your message. The project is currently in the **${project?.stage ?? "intent"}** stage. Agent integration is coming soon — I will be able to help you shape intent, design hypotheses, set up experiments, and analyze results.`,
  });

  await addActivity(projectId, {
    type: "note",
    title: "Conversation message",
    detail: content.trim().slice(0, 120),
  });

  revalidatePath(`/projects/${projectId}`);
}
