import { NextRequest, NextResponse } from "next/server";
import {
  getProvider,
  updateProvider,
  deleteProvider,
  rotateSecret,
  clearSecondarySecret,
  validateBaseUrl,
} from "@/lib/customer-endpoint-providers";
import { requireAuth } from "@/lib/server-auth/guard";

type Params = Promise<{ projectKey: string; id: string }>;

export async function GET(_req: NextRequest, { params }: { params: Params }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { projectKey, id } = await params;
  const provider = await getProvider(projectKey, id);
  if (!provider) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(provider);
}

/**
 * PATCH supports two distinct shapes; routed by `action`:
 *
 *   { action: "update", name?, baseUrl?, timeoutMs? }   → field updates
 *   { action: "rotate-secret" }                          → returns new primary in plaintext ONCE
 *   { action: "clear-secondary" }                        → drop secondarySecret after grace period
 *
 * `action: "update"` is the default when omitted, for ergonomics.
 */
export async function PATCH(req: NextRequest, { params }: { params: Params }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { projectKey, id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const action = (body as { action?: string }).action ?? "update";

  if (action === "rotate-secret") {
    const provider = await rotateSecret(projectKey, id);
    if (!provider) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(provider);
  }

  if (action === "clear-secondary") {
    const provider = await clearSecondarySecret(projectKey, id);
    if (!provider) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(provider);
  }

  if (action !== "update") {
    return NextResponse.json(
      { error: `Unknown action "${action}". Expected "update" | "rotate-secret" | "clear-secondary"` },
      { status: 400 },
    );
  }

  const { name, baseUrl, timeoutMs } = body as {
    name?: unknown;
    baseUrl?: unknown;
    timeoutMs?: unknown;
  };

  const updates: { name?: string; baseUrl?: string; timeoutMs?: number } = {};

  if (name !== undefined) {
    if (typeof name !== "string" || name.length === 0 || name.length > 64) {
      return NextResponse.json({ error: "name must be a 1–64 char string" }, { status: 400 });
    }
    updates.name = name;
  }

  if (baseUrl !== undefined) {
    if (typeof baseUrl !== "string") {
      return NextResponse.json({ error: "baseUrl must be a string" }, { status: 400 });
    }
    const urlCheck = validateBaseUrl(baseUrl);
    if (!urlCheck.ok) return NextResponse.json({ error: urlCheck.error }, { status: 400 });
    updates.baseUrl = urlCheck.normalized;
  }

  if (timeoutMs !== undefined) {
    if (typeof timeoutMs !== "number" || timeoutMs < 1000 || timeoutMs > 60000) {
      return NextResponse.json(
        { error: "timeoutMs must be a number between 1000 and 60000" },
        { status: 400 },
      );
    }
    updates.timeoutMs = Math.floor(timeoutMs);
  }

  try {
    const provider = await updateProvider(projectKey, id, updates);
    if (!provider) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(provider);
  } catch (err) {
    if (err instanceof Error && "code" in err && (err as { code?: string }).code === "P2002") {
      return NextResponse.json(
        { error: `A provider named "${updates.name}" already exists in this project` },
        { status: 409 },
      );
    }
    throw err;
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Params }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { projectKey, id } = await params;
  const ok = await deleteProvider(projectKey, id);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
