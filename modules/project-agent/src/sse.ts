import type { Response } from "express";
import type { SseEventName } from "./types.js";

export function initSseHeaders(res: Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
}

function isWritable(res: Response): boolean {
  return !res.writableEnded && !res.socket?.destroyed;
}

export function sendSseEvent(
  res: Response,
  event: SseEventName,
  data: unknown
): void {
  if (!isWritable(res)) return;
  const payload = JSON.stringify(data);
  res.write(`event: ${event}\ndata: ${payload}\n\n`);
}

export function closeSseStream(res: Response): void {
  if (!isWritable(res)) return;
  res.write(`event: done\ndata: {}\n\n`);
  res.end();
}
