import type { QueryRequestBody } from "./types.js";
import { isKnownSession, projectIdToSessionId } from "./session-id.js";

/**
 * The slash command sent at the start of every *new* session.
 * The SDK resolves `/featbit-release-decision` to the SKILL.md registered
 * under `~/.claude/skills/featbit-release-decision/`.
 * `$1` = project ID, `$2` = access token.
 */
const INITIAL_SLASH_COMMAND = `/featbit-release-decision $1 $2`;

/**
 * Build the prompt string actually sent to the SDK.
 *
 * - **New session** (projectId not yet seen): send the slash command with
 *   project ID and access token as arguments.
 * - **Resumed session** (projectId already seen): return the user prompt as-is.
 */
export function buildEffectivePrompt(body: QueryRequestBody): string {
  const projectId =
    body.projectId ?? process.env.FEATBIT_PROJECT_ID ?? "default";
  const sessionUuid = projectIdToSessionId(projectId);

  // Already-known session → pass prompt through
  if (isKnownSession(sessionUuid)) {
    return body.prompt;
  }

  const accessToken =
    body.accessToken ?? process.env.FEATBIT_ACCESS_TOKEN ?? "";

  return INITIAL_SLASH_COMMAND
    .replace("$1", projectId)
    .replace("$2", accessToken);
}
