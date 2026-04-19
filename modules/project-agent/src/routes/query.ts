import type { Request, Response } from "express";
import { runAgentStream } from "../agent.js";
import type { QueryRequestBody } from "../types.js";

export async function handleQuery(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as QueryRequestBody;
  const abortController = new AbortController();

  // res.on("close") fires when the response writable stream is destroyed —
  // i.e. the client disconnected mid-stream. req.on("close") fires too early
  // in Express 5 (right after headers flush, while SSE is still streaming).
  res.on("close", () => {
    if (!res.writableEnded) abortController.abort();
  });

  await runAgentStream(body, res, abortController);
}
