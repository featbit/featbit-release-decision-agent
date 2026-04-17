import { v5 as uuidv5 } from "uuid";

/**
 * A fixed namespace UUID used to derive deterministic session IDs
 * from experiment IDs via UUID v5.
 */
const NAMESPACE = "a3f1b2c4-d5e6-4f78-9a0b-1c2d3e4f5a6b";

/**
 * Convert an experiment ID string into a deterministic UUID v5.
 * The same experiment ID always produces the same session UUID,
 * so the SDK can resume the session across multiple HTTP calls.
 */
export function projectIdToSessionId(experimentId: string): string {
  return uuidv5(experimentId, NAMESPACE);
}
