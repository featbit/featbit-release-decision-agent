import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { pingCustomerEndpoint } from "@/lib/stats/customer-endpoint-client";

type Params = Promise<{ projectKey: string; id: string }>;

/**
 * POST /api/projects/[projectKey]/customer-endpoints/[id]/test
 *
 * Sends a §8 ping (experimentId="featbit-ping", metrics=[]) to the provider's
 * baseUrl. Returns a flat shape the UI can render directly:
 *
 *   { ok: true,  durationMs: 312, attempts: 1 }
 *   { ok: false, kind: "http", message: "503 Service Unavailable",
 *                durationMs: 41, attempts: 3, body: {...} }
 *
 * The full plaintext signing secret is loaded from the DB here (it's required
 * to compute the HMAC) but never returned in the response.
 */
export async function POST(_req: NextRequest, { params }: { params: Params }) {
  const { projectKey, id } = await params;

  const provider = await prisma.customerEndpointProvider.findUnique({ where: { id } });
  if (!provider || provider.projectKey !== projectKey) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const result = await pingCustomerEndpoint({
    baseUrl:       provider.baseUrl,
    signingSecret: provider.signingSecret,
    timeoutMs:     provider.timeoutMs,
  });

  if (result.ok) {
    return NextResponse.json({
      ok:         true,
      attempts:   result.attempts,
      computedAt: result.response.computedAt,
    });
  }

  return NextResponse.json(
    {
      ok:         false,
      attempts:   result.attempts,
      kind:       result.error.kind,
      status:     result.error.status,
      message:    result.error.message,
      durationMs: result.error.durationMs,
      body:       result.error.body,
    },
    { status: 200 },  // 200 even on failure — the UI surfaces the error inline
  );
}
