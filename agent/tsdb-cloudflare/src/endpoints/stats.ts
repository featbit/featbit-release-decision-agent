/**
 * GET /api/stats — Simple storage statistics.
 *
 * Counts segments and total size per table prefix in R2.
 */

import type { Env } from "../env";

interface TableStats {
  segments: number;
  totalBytes: number;
}

export async function handleStats(
  _request: Request,
  env: Env,
): Promise<Response> {
  const tables = ["flag-evals/", "metric-events/"];
  const stats: Record<string, TableStats> = {};

  for (const prefix of tables) {
    let segments = 0;
    let totalBytes = 0;
    let cursor: string | undefined;

    do {
      const list = await env.TSDB_BUCKET.list({ prefix, cursor });
      for (const obj of list.objects) {
        segments++;
        totalBytes += obj.size;
      }
      cursor = list.truncated ? list.cursor : undefined;
    } while (cursor);

    stats[prefix.replace("/", "")] = { segments, totalBytes };
  }

  return Response.json(stats);
}
