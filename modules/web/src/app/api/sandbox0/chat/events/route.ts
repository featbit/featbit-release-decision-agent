/**
 * GET /api/sandbox0/chat/events?sessionId=<id>&afterId=<evt_id>
 *
 * Poll-mode event feed. The client keeps calling this with the latest
 * `afterId` it has received until `done: true`. Semantically equivalent to
 * SSE but friendlier to run behind any proxy without tuning idle timeouts.
 *
 * Returns: { events: ChatEvent[], status: string, done: boolean }
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionEvents, getSessionStatus } from "@/lib/sandbox0/client";
import { requireAuth } from "@/lib/server-auth/guard";

export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get("sessionId");
    const afterId = searchParams.get("afterId") ?? undefined;

    if (!sessionId) {
      return NextResponse.json(
        { error: "sessionId is required" },
        { status: 400 },
      );
    }

    const [status, events] = await Promise.all([
      getSessionStatus(sessionId),
      getSessionEvents(sessionId, afterId),
    ]);

    const done = status === "idle" || status === "terminated";
    return NextResponse.json({ events, status, done });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/sandbox0/chat/events]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
