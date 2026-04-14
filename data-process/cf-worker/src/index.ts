import type { Env } from "./env";
import { handleTrack } from "./endpoints/track";
import { handleQuery } from "./endpoints/query";
import { handleDevFlush } from "./endpoints/dev-flush";

export { PartitionWriterDO } from "./durable-objects/partition-writer";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const { pathname } = new URL(request.url);

      if (pathname === "/api/track" && request.method === "POST") {
        return handleTrack(request, env);
      }

      if (pathname === "/api/query/experiment" && request.method === "POST") {
        return handleQuery(request, env);
      }

      if (pathname === "/dev/flush" && request.method === "POST") {
        return handleDevFlush(request, env);
      }

      if (pathname === "/health") {
        return new Response("ok");
      }

      return new Response("Not Found", { status: 404 });
    } catch (err) {
      const msg = err instanceof Error ? `${err.message}\n${err.stack}` : String(err);
      console.error("Unhandled error:", msg);
      return new Response(JSON.stringify({ error: msg }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  },
} satisfies ExportedHandler<Env>;
