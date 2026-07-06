/**
 * Canonical PUBLIC base URL for the remote MCP server.
 *
 * MCP discovery (RFC 9728 protected-resource metadata + the `WWW-Authenticate`
 * `resource_metadata` pointer) is consumed by EXTERNAL clients — e.g. claude.ai's
 * connector UI, which reads these to drive its OAuth flow. The advertised origin
 * must therefore be the public hostname. Behind Istio/CloudFront
 * `req.nextUrl.origin` resolves to the internal upstream origin (localhost:3000),
 * which external clients can't reach — so discovery must NOT use it.
 *
 * Precedence mirrors the MCP connect route's `resolveBaseUrl()`: an explicit
 * public base URL first, then the app's canonical `NEXTAUTH_URL`, falling back to
 * the request origin and finally localhost for local dev.
 */
import type { NextRequest } from 'next/server';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';

// LEVERAGE: pattern public-base-url — same precedence chain lives in
// server/.../mcp/connect/start/route.ts (resolveBaseUrl) and email/oauth/initiate;
// a shared core resolver would let all three drop their copies.
export async function resolvePublicBaseUrl(req: NextRequest): Promise<string> {
  const sp = await getSecretProviderInstance();
  const base =
    process.env.NEXT_PUBLIC_BASE_URL ||
    (await sp.getAppSecret('NEXT_PUBLIC_BASE_URL')) ||
    process.env.NEXTAUTH_URL ||
    (await sp.getAppSecret('NEXTAUTH_URL')) ||
    req.nextUrl.origin ||
    'http://localhost:3000';
  return base.replace(/\/$/, '');
}

/**
 * INTERNAL base URL for dispatching MCP tool calls back into this server's own
 * `/api/v1` surface. This is the opposite of the public discovery URL above: an
 * in-pod loopback over plaintext HTTP that must NEVER be the public origin.
 *
 * Routing tool dispatch through the public hostname (`req.nextUrl.origin`) sends
 * each call out via the ingress/TLS path and back into the pod; that round-trip
 * intermittently fails the TLS handshake (`ERR_SSL_WRONG_VERSION_NUMBER` →
 * `TypeError: fetch failed`) and surfaces to the MCP client as HTTP 500s. A
 * fixed loopback target avoids the mesh/TLS path entirely. Port precedence
 * mirrors `getSessionCookieName`'s server-port resolution.
 *
 * LEVERAGE: friction mcp-self-http-dispatch — dispatch needs an HTTP base at all
 * only because `/api/v1` auth + rate-limit + RBAC are welded to `NextRequest` in
 * `ApiBaseController`, and the registry maps tools to method+path, not to
 * functions. The real fix is a transport-free `dispatch(entryId, args, authCtx)`
 * core shared by the route handlers and this server (in-process, no HTTP hop).
 */
export function resolveInternalBaseUrl(): string {
  const port =
    process.env.PORT || process.env.APP_PORT || process.env.EXPOSE_SERVER_PORT || '3000';
  return `http://127.0.0.1:${port}`;
}
