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
