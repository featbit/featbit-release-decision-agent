export interface QueryRequestBody {
  /** User prompt. Empty string → bootstrap (load skills + session brief). */
  prompt?: string;
  /** FeatBit project key for this session. Falls back to FEATBIT_PROJECT_KEY env. */
  projectKey?: string;
  /** FeatBit user id for this session. Falls back to FEATBIT_USER_ID env. */
  userId?: string;
  /**
   * Optional client-supplied key to group turns into a session. Defaults to
   * "{projectKey}:{userId}". Same sessionKey → resume the same Codex thread.
   */
  sessionKey?: string;
  /**
   * Codex thread ID from a previous session. When provided, project-agent
   * will attempt to resume this thread directly (bypasses in-memory lookup).
   */
  codexThreadId?: string;
}

export type SseEventName =
  | "thread_started"
  | "turn_started"
  | "turn_completed"
  | "turn_failed"
  | "item_started"
  | "item_updated"
  | "item_completed"
  | "error"
  | "system";
