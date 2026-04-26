import { NextResponse } from "next/server";
import { exchangeAndCreateSession, ExchangeError } from "@/lib/server-auth/exchange";

export const runtime = "nodejs";

interface Body {
  code?: string;
  workspaceKey?: string;
  redirectUri?: string;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.code || !body.workspaceKey || !body.redirectUri) {
    return NextResponse.json(
      { error: "code, workspaceKey and redirectUri are required" },
      { status: 400 },
    );
  }

  try {
    const result = await exchangeAndCreateSession("/sso/oidc/login", {
      code: body.code,
      workspaceKey: body.workspaceKey,
      redirectUri: body.redirectUri,
    });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof ExchangeError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: "SSO exchange failed" }, { status: 500 });
  }
}
