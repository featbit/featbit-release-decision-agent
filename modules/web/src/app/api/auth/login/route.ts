import { NextResponse } from "next/server";
import { exchangeAndCreateSession, ExchangeError } from "@/lib/server-auth/exchange";

export const runtime = "nodejs";

interface Body {
  email?: string;
  password?: string;
  workspaceKey?: string;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.email || !body.password) {
    return NextResponse.json(
      { error: "Email and password required" },
      { status: 400 },
    );
  }

  try {
    const result = await exchangeAndCreateSession("/identity/login-by-email", {
      email: body.email,
      password: body.password,
      workspaceKey: body.workspaceKey,
    });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof ExchangeError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
