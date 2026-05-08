import type { QueryRequestBody } from "./types.js";

/**
 * Slash command sent at the start of every new session. Resolves to the
 * SKILL.md registered under `~/.claude/skills/featbit-release-decision/`.
 * `$1` = experiment ID, `$2` = access token.
 */
const INITIAL_SLASH_COMMAND = `/featbit-release-decision $1 $2`;

export interface EffectivePrompt {
  prompt: string;
  /** True when the user prompt is empty and we are bootstrapping a new session. */
  isBootstrap: boolean;
}

export function buildEffectivePrompt(body: QueryRequestBody): EffectivePrompt {
  const userPrompt = body.prompt?.trim() ?? "";

  if (userPrompt) {
    return { prompt: userPrompt, isBootstrap: false };
  }

  const experimentId =
    body.experimentId ?? body.projectId ?? process.env.FEATBIT_PROJECT_ID ?? "default";
  // ACCESS_TOKEN matches the env name shown in the web UI (Env Settings →
  // Agent tokens) and used by sync.ts. FEATBIT_ACCESS_TOKEN is the legacy
  // name kept as a fallback so older setup docs keep working.
  const accessToken =
    body.accessToken
    ?? process.env.ACCESS_TOKEN
    ?? process.env.FEATBIT_ACCESS_TOKEN
    ?? "";

  const prompt = INITIAL_SLASH_COMMAND
    .replace("$1", experimentId)
    .replace("$2", accessToken);

  return { prompt, isBootstrap: true };
}
