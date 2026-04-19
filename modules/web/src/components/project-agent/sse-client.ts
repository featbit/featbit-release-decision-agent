/**
 * POST-based SSE reader. Browser EventSource only supports GET, so we parse
 * the text/event-stream body manually from fetch's ReadableStream.
 *
 * Yields one parsed event per message. Events are plain objects with
 * `event` and `data` (already JSON-parsed when possible).
 */
export interface SseEvent {
  event: string;
  data: unknown;
}

export async function* streamSseEvents(
  url: string,
  body: unknown,
  signal: AbortSignal
): AsyncGenerator<SseEvent, void, void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok || !res.body) {
    throw new Error(
      `project-agent returned HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}`
    );
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by a blank line ("\n\n").
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const parsed = parseSseChunk(raw);
        if (parsed) yield parsed;
      }
    }
    // flush
    const leftover = buffer.trim();
    if (leftover) {
      const parsed = parseSseChunk(leftover);
      if (parsed) yield parsed;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
}

function parseSseChunk(raw: string): SseEvent | null {
  let eventName = "message";
  const dataLines: string[] = [];
  for (const line of raw.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    const value =
      colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
    if (field === "event") eventName = value;
    else if (field === "data") dataLines.push(value);
  }
  if (dataLines.length === 0) return null;
  const raw2 = dataLines.join("\n");
  let data: unknown = raw2;
  try {
    data = JSON.parse(raw2);
  } catch {
    // non-JSON payload — leave as string
  }
  return { event: eventName, data };
}
