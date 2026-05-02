import { NextRequest, NextResponse } from "next/server";
import {
  listProviders,
  createProvider,
  validateBaseUrl,
} from "@/lib/customer-endpoint-providers";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ projectKey: string }> },
) {
  const { projectKey } = await params;
  const providers = await listProviders(projectKey);
  return NextResponse.json(providers);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectKey: string }> },
) {
  const { projectKey } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { name, baseUrl, timeoutMs } = body as {
    name?: unknown;
    baseUrl?: unknown;
    timeoutMs?: unknown;
  };

  if (typeof name !== "string" || name.length === 0 || name.length > 64) {
    return NextResponse.json({ error: "name must be a 1–64 char string" }, { status: 400 });
  }
  if (typeof baseUrl !== "string") {
    return NextResponse.json({ error: "baseUrl must be a string" }, { status: 400 });
  }
  const urlCheck = validateBaseUrl(baseUrl);
  if (!urlCheck.ok) {
    return NextResponse.json({ error: urlCheck.error }, { status: 400 });
  }
  let timeoutMsValidated: number | undefined;
  if (timeoutMs !== undefined) {
    if (typeof timeoutMs !== "number" || timeoutMs < 1000 || timeoutMs > 60000) {
      return NextResponse.json(
        { error: "timeoutMs must be a number between 1000 and 60000" },
        { status: 400 },
      );
    }
    timeoutMsValidated = Math.floor(timeoutMs);
  }

  try {
    const provider = await createProvider(projectKey, {
      name,
      baseUrl: urlCheck.normalized,
      timeoutMs: timeoutMsValidated,
    });
    return NextResponse.json(provider, { status: 201 });
  } catch (err) {
    // Prisma P2002 = unique constraint violation on (project_key, name)
    if (err instanceof Error && "code" in err && (err as { code?: string }).code === "P2002") {
      return NextResponse.json(
        { error: `A provider named "${name}" already exists in this project` },
        { status: 409 },
      );
    }
    throw err;
  }
}
