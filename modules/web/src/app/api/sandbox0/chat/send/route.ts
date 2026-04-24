/**
 * POST /api/sandbox0/chat/send
 *
 * Body: { sessionId: string, message: string }
 * Returns: { ok: true }
 */

import { NextRequest, NextResponse } from "next/server";
import { sendChatMessage } from "@/lib/sandbox0/client";

export async function POST(req: NextRequest) {
  try {
    const body: { sessionId?: string; message?: string } = await req
      .json()
      .catch(() => ({}));
    const { sessionId, message } = body;
    if (!sessionId || !message) {
      return NextResponse.json(
        { error: "sessionId and message are required" },
        { status: 400 },
      );
    }
    await sendChatMessage(sessionId, message);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/sandbox0/chat/send]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
