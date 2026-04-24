/**
 * POST /api/sandbox0/chat/start
 *
 * Body: { experimentId: string }  (accepts `projectId` as a legacy alias)
 * Returns: { sessionId: string }
 *
 * Reuses a live session if the experiment already has one. Otherwise creates
 * a new session on sandbox0, persists the session id on the experiment, and
 * sends the bootstrap slash command so the agent loads decision state from
 * the DB via get-experiment.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  resolveSession,
  buildBootstrapMessage,
  sendMessage,
} from "@/lib/sandbox0/session";

export async function POST(req: NextRequest) {
  try {
    const body: {
      experimentId?: string;
      projectId?: string;
    } = await req.json().catch(() => ({}));
    const experimentId = (body.experimentId ?? body.projectId ?? "").trim();
    if (!experimentId) {
      return NextResponse.json(
        { error: "experimentId is required in request body" },
        { status: 400 },
      );
    }

    const sessionInfo = await resolveSession(experimentId);
    if (sessionInfo.isNew) {
      await sendMessage(
        sessionInfo.sessionId,
        buildBootstrapMessage(sessionInfo, experimentId),
      );
    }
    return NextResponse.json({
      sessionId: sessionInfo.sessionId,
      isNew: sessionInfo.isNew,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/sandbox0/chat/start]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
