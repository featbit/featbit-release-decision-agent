import { v5 as uuidv5 } from "uuid";

const NAMESPACE = "a3f1b2c4-d5e6-4f78-9a0b-1c2d3e4f5a6b";

/**
 * Map an experiment ID to a deterministic UUID v5 so the SDK resumes the
 * same Claude Code session across HTTP calls for the same experiment.
 */
export function projectIdToSessionId(experimentId: string): string {
  return uuidv5(experimentId, NAMESPACE);
}
