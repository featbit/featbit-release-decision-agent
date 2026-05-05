// Server-side absolute URL — used only by code in src/lib/server-auth/* when
// it makes server-to-server calls into FeatBit. Browsers must NEVER hit this
// origin directly; they go through the same-origin /api/featbit-proxy route.
//
// Server-only env (no NEXT_PUBLIC_ prefix), so docker / kubernetes can set
// it at container runtime — no rebuild required when the FeatBit URL changes.
export const FEATBIT_API_URL = (
  process.env.FEATBIT_API_URL || "http://localhost:5000"
).replace(/\/+$/, "");

export const FEATBIT_API_V1 = `${FEATBIT_API_URL}/api/v1`;

// What the browser SDK uses. Same-origin so the fb_session HttpOnly cookie
// is included automatically; the server proxy attaches the Bearer token.
export const FEATBIT_PROXY_PREFIX = "/api/featbit-proxy";
