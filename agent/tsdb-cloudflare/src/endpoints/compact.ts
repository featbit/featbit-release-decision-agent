/**
 * POST /api/compact — triggers daily rollup compaction for specified partitions.
 */

import type { Env } from "../env";
import { compact, type CompactRequest } from "../rollup/compact";

export async function handleCompact(
  request: Request,
  env: Env,
): Promise<Response> {
  const body = (await request.json()) as Partial<CompactRequest>;

  if (!body.envId || !body.flagKey || !body.startDate || !body.endDate) {
    return Response.json(
      { error: "envId, flagKey, startDate, endDate are required" },
      { status: 400 },
    );
  }

  const req: CompactRequest = {
    envId: body.envId,
    flagKey: body.flagKey,
    metricEvents: body.metricEvents ?? [],
    startDate: body.startDate,
    endDate: body.endDate,
    force: body.force ?? false,
  };

  const result = await compact(env.TSDB_BUCKET, req);
  return Response.json(result);
}
