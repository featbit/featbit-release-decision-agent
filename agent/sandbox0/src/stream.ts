/**
 * stream.ts
 *
 * Processes the SSE event stream from Claude Managed Agents and renders
 * events to the console via the ui module.
 *
 * Event types from the Managed Agents API:
 *   agent.message        — text content blocks from the agent
 *   agent.tool_use       — the agent is about to call a tool
 *   agent.tool_result    — result of a tool call
 *   session.status_idle  — agent has finished; nothing more to do
 *   session.status_error — session entered an error state
 */

import { ui } from "./ui.js";

export type StreamResult =
  | { done: true }
  | { done: false; error: string };

/**
 * Consume the event stream until the session goes idle or errors.
 * Renders all events to the console.
 */
export async function processStream(stream: AsyncIterable<any>): Promise<StreamResult> {
  let textStarted = false;

  for await (const event of stream) {
    const type: string = event?.type ?? "";

    switch (type) {
      case "agent.message": {
        // Complete agent turn — render text content
        const content: any[] = event.content ?? [];
        for (const block of content) {
          if (block.type === "text") {
            if (!textStarted) {
              process.stdout.write(chalk_bold_cyan("Agent: "));
              textStarted = true;
            }
            ui.agentText(block.text);
          }
        }
        if (textStarted) {
          ui.agentTextEnd();
          textStarted = false;
        }
        break;
      }

      case "agent.tool_use": {
        if (textStarted) {
          ui.agentTextEnd();
          textStarted = false;
        }
        ui.toolUse(event.name, event.input);
        break;
      }

      case "agent.tool_result": {
        // Render a short preview of tool output
        const content: any[] = event.content ?? [];
        const text = content
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text as string)
          .join("\n");
        if (text) ui.toolResult(text);
        break;
      }

      case "session.status_idle": {
        if (textStarted) {
          ui.agentTextEnd();
          textStarted = false;
        }
        ui.agentIdle();
        return { done: true };
      }

      case "session.status_terminated": {
        if (textStarted) {
          ui.agentTextEnd();
          textStarted = false;
        }
        const message: string = event.error?.message ?? "Session terminated (unrecoverable error)";
        ui.error(`Session terminated: ${message}`);
        return { done: false, error: message };
      }

      case "session.error": {
        if (textStarted) {
          ui.agentTextEnd();
          textStarted = false;
        }
        const errMsg: string = event.error?.message ?? "Session error";
        ui.warn(`Session error: ${errMsg} (retry_status: ${event.error?.retry_status ?? "unknown"})`);
        // session.error is not necessarily fatal — session may auto-retry via rescheduling
        break;
      }

      // Ignore other event types (heartbeats, etc.)
      default:
        break;
    }
  }

  // Stream ended without an idle event
  if (textStarted) {
    ui.agentTextEnd();
  }
  return { done: true };
}

/** Inline colour helper — avoids importing chalk twice */
function chalk_bold_cyan(text: string): string {
  return `\x1b[1m\x1b[36m${text}\x1b[0m`;
}
