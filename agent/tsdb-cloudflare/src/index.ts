/**
 * Cloudflare Worker entry point.
 *
 * Routes:
 *   POST /api/track              → ingest flag evals & metric events
 *   POST /api/query/experiment   → run experiment metric query
 *   GET  /api/stats              → storage statistics
 */

import type { Env } from "./env";
import { handleTrack } from "./endpoints/track";
import { handleQuery } from "./endpoints/query";
import { handleStats } from "./endpoints/stats";

// Re-export the Durable Object class so wrangler can bind it.
export { PartitionWriterDO } from "./durable-objects/partition-writer";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === "/api/track" && request.method === "POST") {
      return handleTrack(request, env);
    }

    if (pathname === "/api/query/experiment" && request.method === "POST") {
      return handleQuery(request, env);
    }

    if (pathname === "/api/stats" && request.method === "GET") {
      return handleStats(request, env);
    }

    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
