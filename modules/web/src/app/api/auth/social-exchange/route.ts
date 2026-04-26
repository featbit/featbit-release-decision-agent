import { NextResponse } from "next/server";
import { exchangeAndCreateSession, ExchangeError } from "@/lib/server-auth/exchange";

export const runtime = "nodejs";

interface Body {
  code?: string;
  providerName?: string;
  redirectUri?: string;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.code || !body.providerName || !body.redirectUri) {
    return NextResponse.json(
      { error: "code, providerName and redirectUri are required" },
      { status: 400 },
    );
  }

  try {
    const result = await exchangeAndCreateSession("/social/login", {
      code: body.code,
      providerName: body.providerName,
      redirectUri: body.redirectUri,
    });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof ExchangeError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: "OAuth exchange failed" }, { status: 500 });
  }
}
