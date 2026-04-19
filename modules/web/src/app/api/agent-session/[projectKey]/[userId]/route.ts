import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ projectKey: string; userId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { projectKey, userId } = await params;
  const session = await prisma.projectAgentSession.findUnique({
    where: { projectKey_userId: { projectKey, userId } },
  });
  if (!session) return NextResponse.json(null);
  return NextResponse.json({
    codexThreadId: session.codexThreadId,
    messages: JSON.parse(session.messages),
  });
}

export async function PUT(req: NextRequest, { params }: Params) {
  const { projectKey, userId } = await params;
  const body = (await req.json()) as {
    codexThreadId?: string;
    messages?: unknown[];
  };

  const existing = await prisma.projectAgentSession.findUnique({
    where: { projectKey_userId: { projectKey, userId } },
  });

  const data = {
    codexThreadId:
      body.codexThreadId !== undefined
        ? body.codexThreadId
        : (existing?.codexThreadId ?? null),
    messages:
      body.messages !== undefined
        ? JSON.stringify(body.messages)
        : (existing?.messages ?? "[]"),
  };

  const session = await prisma.projectAgentSession.upsert({
    where: { projectKey_userId: { projectKey, userId } },
    create: { projectKey, userId, ...data },
    update: data,
  });

  return NextResponse.json({
    codexThreadId: session.codexThreadId,
    messages: JSON.parse(session.messages),
  });
}
