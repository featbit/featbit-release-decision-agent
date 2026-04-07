import type { QueryRequestBody } from "./types.js";

/**
 * The slash command sent at the start of every *new* session.
 * The SDK resolves `/featbit-release-decision` to the SKILL.md registered
 * under `~/.claude/skills/featbit-release-decision/`.
 * `$1` = project ID, `$2` = access token, `$ARGUMENTS` includes all args.
 */
// const INITIAL_SLASH_COMMAND = `/featbit-release-decision $1 $2 "This is a new session. Please greet the user briefly, then ask them to describe the experiment or feature change they want to work on. Your first question should be something like: Please describe the experiment or feature change you'd like to work on, and I'll guide you through the process."`;
const INITIAL_SLASH_COMMAND = `/featbit-release-decision $1 $2`;


/**
 * Build the prompt string actually sent to the SDK.
 *
 * - **New session** (no `sessionId`): send the slash command with
 *   project ID and access token as arguments.
 * - **Resumed session** (has `sessionId`): return the user prompt as-is.
 */
export function buildEffectivePrompt(body: QueryRequestBody): string {
  // Resumed session → pass through
  if (body.sessionId) {
    return body.prompt;
  }

  const projectId =
    body.projectId ?? process.env.FEATBIT_PROJECT_ID ?? "default";
  const accessToken =
    body.accessToken ?? process.env.FEATBIT_ACCESS_TOKEN ?? "";

  return INITIAL_SLASH_COMMAND
    .replace("$1", projectId)
    .replace("$2", accessToken);
}
