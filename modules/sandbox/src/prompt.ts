import type { QueryRequestBody } from "./types.js";

/**
 * The slash command sent at the start of every new session.
 * The SDK resolves `/featbit-release-decision` to the SKILL.md registered
 * under `~/.claude/skills/featbit-release-decision/`.
 * `$1` = experiment ID, `$2` = access token.
 */
const INITIAL_SLASH_COMMAND = `/featbit-release-decision $1 $2`;

export interface EffectivePrompt {
  /** The prompt string to send to the SDK. */
  prompt: string;
  /** True if this is a fresh bootstrap (empty user prompt → slash command). */
  isBootstrap: boolean;
}

/**
 * Decide what prompt actually goes to the SDK.
 *
 * - Empty user prompt → treat as bootstrap: send the skill slash command.
 * - Non-empty user prompt → pass through as a continuation.
 *
 * Session create-vs-resume is decided at call time by `agent.ts`, not here.
 * This function has no side-effects and reads no persisted state.
 */
export function buildEffectivePrompt(body: QueryRequestBody): EffectivePrompt {
  const userPrompt = body.prompt?.trim() ?? "";

  if (userPrompt) {
    return { prompt: userPrompt, isBootstrap: false };
  }

  const experimentId =
    body.experimentId ?? body.projectId ?? process.env.FEATBIT_PROJECT_ID ?? "default";
  const accessToken =
    body.accessToken ?? process.env.FEATBIT_ACCESS_TOKEN ?? "";

  const prompt = INITIAL_SLASH_COMMAND
    .replace("$1", experimentId)
    .replace("$2", accessToken);

  return { prompt, isBootstrap: true };
}
