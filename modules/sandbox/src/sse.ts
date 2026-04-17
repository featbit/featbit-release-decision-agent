import type { Response } from "express";
import type { SseEventName } from "./types.js";

/**
 * Write the required SSE headers on a response.
 * Must be called before any data is sent.
 */
export function initSseHeaders(res: Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // disable nginx buffering
  res.flushHeaders();
}

/**
 * Check whether the response is still writable.
 */
function isWritable(res: Response): boolean {
  return !res.writableEnded && !res.socket?.destroyed;
}

/**
 * Send a single SSE event to the client.
 */
export function sendSseEvent(
  res: Response,
  event: SseEventName,
  data: unknown
): void {
  if (!isWritable(res)) return;
  const payload = JSON.stringify(data);
  res.write(`event: ${event}\ndata: ${payload}\n\n`);
}

/**
 * Send the terminal "done" event and end the response.
 */
export function closeSseStream(res: Response): void {
  if (!isWritable(res)) return;
  res.write(`event: done\ndata: {}\n\n`);
  res.end();
}
