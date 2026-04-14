/**
 * POST /dev/flush
 * Dev-only endpoint — forces specified DO instances to write their buffer
 * as a delta file to R2 immediately (bypasses the 10-minute wait).
 *
 * Body: { partKeys: string[] }
 * Returns: { flushed: string[] }
 */
import type { Env } from "../env";

export async function handleDevFlush(request: Request, env: Env): Promise<Response> {
  const { partKeys } = await request.json() as { partKeys: string[] };

  if (!Array.isArray(partKeys) || partKeys.length === 0) {
    return new Response("partKeys required", { status: 400 });
  }

  const results = await Promise.allSettled(
    partKeys.map(async (partKey) => {
      const stub = env.PARTITION_WRITER.get(env.PARTITION_WRITER.idFromName(partKey));
      const res  = await stub.fetch("https://do/flush", { method: "POST" });
      if (!res.ok) throw new Error(`DO flush failed for ${partKey}: ${res.status}`);
      return partKey;
    }),
  );

  const flushed = results
    .filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled")
    .map((r) => r.value);

  const failed = results
    .filter((r): r is PromiseRejectedResult => r.status === "rejected")
    .map((r) => r.reason as string);

  return new Response(JSON.stringify({ flushed, failed }), {
    headers: { "Content-Type": "application/json" },
  });
}
