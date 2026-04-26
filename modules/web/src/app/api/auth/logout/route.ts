import { NextResponse } from "next/server";
import { getSessionCookie, clearSessionCookie } from "@/lib/server-auth/cookie";
import { destroySession, loadSessionById } from "@/lib/server-auth/sessions";
import { bridgeFetch } from "@/lib/server-auth/featbit-bridge";

export const runtime = "nodejs";

export async function POST() {
  const id = await getSessionCookie();
  if (id) {
    const session = await loadSessionById(id);
    if (session) {
      // Best-effort logout on FeatBit; ignore failures.
      await bridgeFetch("/identity/logout", {
        method: "POST",
        token: session.token,
        cookies: session.cookies,
      }).catch(() => undefined);
    }
    await destroySession(id);
  }
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
