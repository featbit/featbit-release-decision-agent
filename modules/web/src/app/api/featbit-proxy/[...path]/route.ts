import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/server-auth/require";
import {
  bridgeFetch,
  mergeCookies,
  refreshFeatBitToken,
  type FeatBitCookie,
} from "@/lib/server-auth/featbit-bridge";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FORWARDABLE_REQUEST_HEADERS = ["content-type", "accept"];

interface RouteParams {
  params: Promise<{ path?: string[] }>;
}

async function handle(req: NextRequest, ctx: RouteParams): Promise<Response> {
  const { path } = await ctx.params;
  const segments = path ?? [];
  const targetPath = `/${segments.join("/")}`;

  const session = await getSession();

  const url = new URL(req.url);
  const query: Record<string, string> = {};
  url.searchParams.forEach((v, k) => {
    query[k] = v;
  });

  const headers: Record<string, string> = {};
  for (const name of FORWARDABLE_REQUEST_HEADERS) {
    const v = req.headers.get(name);
    if (v) headers[name] = v;
  }
  // Caller-supplied org/workspace headers win; otherwise fall back to session.
  // Header names are case-insensitive in HTTP; Next normalises to lowercase.
  const orgOverride =
    req.headers.get("organization") ?? session?.organizationId ?? null;
  const wsOverride =
    req.headers.get("workspace") ?? session?.workspaceId ?? null;

  const body =
    req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer();

  const init = {
    method: req.method,
    headers,
    body,
    query,
    token: session?.token ?? null,
    cookies: session?.cookies ?? [],
    organizationId: orgOverride,
    workspaceId: wsOverride,
  };

  let res = await bridgeFetch(targetPath, init);

  // Persist any updated cookies (FeatBit may rotate refresh cookies on use).
  if (session && res.setCookies.length > 0) {
    const merged = mergeCookies(session.cookies, res.setCookies);
    await prisma.authSession
      .update({ where: { id: session.id }, data: { featbitCookies: merged as unknown as object } })
      .catch(() => undefined);
    init.cookies = merged;
  }

  // 401 with a session: refresh once and retry. (refreshIfNeeded already runs
  // inside getSession, so this catches the case where the access token was
  // invalidated server-side mid-window.)
  if (res.status === 401 && session) {
    const refresh = await refreshFeatBitToken(init.cookies);
    if (refresh.ok && refresh.token) {
      const updated = await prisma.authSession.update({
        where: { id: session.id },
        data: {
          featbitToken: refresh.token,
          featbitCookies: (refresh.cookies ?? init.cookies) as unknown as object,
          refreshedAt: new Date(),
        },
      });
      res = await bridgeFetch(targetPath, {
        ...init,
        token: updated.featbitToken,
        cookies: (updated.featbitCookies as unknown as FeatBitCookie[]) ?? init.cookies,
      });
    }
  }

  const responseHeaders = new Headers();
  const ct = res.headers.get("content-type");
  if (ct) responseHeaders.set("content-type", ct);

  return new NextResponse(res.bodyText, {
    status: res.status,
    headers: responseHeaders,
  });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
