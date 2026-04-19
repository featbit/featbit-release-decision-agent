/**
 * In-memory mapping from a logical session key (projectKey:userId by default)
 * to a Codex thread id. Lives only for the lifetime of this process; Codex
 * itself persists thread state under ~/.codex/sessions so resumption still
 * reaches the same backend conversation.
 *
 * v1 intentionally uses a plain Map. When we containerise project-agent and
 * run multiple instances behind a load balancer, this needs to become a
 * shared store (Redis, Postgres, or a column on the FeatBit project record).
 */
const threadByKey = new Map<string, string>();

export function getThreadId(key: string): string | undefined {
  return threadByKey.get(key);
}

export function setThreadId(key: string, threadId: string): void {
  threadByKey.set(key, threadId);
}

export function forgetThread(key: string): void {
  threadByKey.delete(key);
}

export function resolveSessionKey(
  projectKey: string,
  userId: string | undefined,
  explicit: string | undefined
): string {
  if (explicit && explicit.trim()) return explicit.trim();
  return `${projectKey}:${userId ?? "anonymous"}`;
}
