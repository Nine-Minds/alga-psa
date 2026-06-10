import { createRemoteJWKSet, jwtVerify, decodeJwt, type JWTPayload } from 'jose';
import { findTrustedIdpsByIssuer, resolveAgentByIdp, type ResolvedAgent } from './agents';
import { getBuiltinIdpForIssuer } from './idpBuiltins';

/**
 * IdP-delegated token validation (Phase 2 F025/F029/F042). The MCP server is an
 * OAuth 2.1 resource server: it validates a bearer JWT against a tenant-trusted
 * IdP's JWKS (issuer + audience/resource + signature), then maps the token's
 * subject claim to a provisioned agent. No Alga authorization server.
 */

export interface AgentTokenContext {
  resolved: ResolvedAgent;
  claims: JWTPayload;
}

export type AgentTokenResult =
  | { ok: true; ctx: AgentTokenContext }
  | { ok: false; status: number; error: string };

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
function getJwks(jwksUri: string): ReturnType<typeof createRemoteJWKSet> {
  let set = jwksCache.get(jwksUri);
  if (!set) {
    set = createRemoteJWKSet(new URL(jwksUri));
    jwksCache.set(jwksUri, set);
  }
  return set;
}

/** A bearer token is an IdP JWT (vs an Alga API key) if it has 3 dot-segments. */
export function looksLikeJwt(token: string): boolean {
  return token.split('.').length === 3;
}

/**
 * A validation candidate: a tenant-registered IdP row OR a hosted built-in
 * (Tier 2). `tenant: null` marks a built-in, which is instance-wide — the
 * agent's tenant is determined solely by the (issuer, subject) binding, so the
 * tenant-match check is skipped for it.
 */
interface IdpCandidate {
  jwksUri: string;
  audience: string | null;
  subjectClaim: string;
  tenant: string | null;
}

export async function authenticateAgentToken(
  token: string,
  opts: { subjectClaim?: string } = {},
): Promise<AgentTokenResult> {
  let issuer: string | undefined;
  try {
    issuer = decodeJwt(token).iss;
  } catch {
    return { ok: false, status: 401, error: 'Bearer token is not a valid JWT.' };
  }
  if (!issuer) return { ok: false, status: 401, error: 'Token is missing the "iss" claim.' };

  const candidates: IdpCandidate[] = (await findTrustedIdpsByIssuer(issuer)).map((idp) => ({
    jwksUri: idp.jwks_uri,
    audience: idp.audience,
    subjectClaim: idp.subject_claim,
    tenant: idp.tenant,
  }));
  // Hosted built-ins (Google/Microsoft shared apps) extend the trust set when
  // the SaaS shared-app secrets are present, so hosted tenants need no IdP row.
  const builtin = await getBuiltinIdpForIssuer(issuer);
  if (builtin) {
    candidates.push({ ...builtin, tenant: null });
  }
  if (candidates.length === 0) {
    return { ok: false, status: 401, error: `Untrusted token issuer: ${issuer}` };
  }

  let lastError = 'Token verification failed.';
  for (const cand of candidates) {
    try {
      const { payload } = await jwtVerify(token, getJwks(cand.jwksUri), {
        issuer,
        audience: cand.audience ?? undefined,
      });
      const subjectClaim = opts.subjectClaim ?? cand.subjectClaim ?? 'sub';
      const subject = String(
        (payload as Record<string, unknown>)[subjectClaim] ?? payload.sub ?? '',
      );
      if (!subject) {
        lastError = `Token missing subject claim "${subjectClaim}".`;
        continue;
      }
      const resolved = await resolveAgentByIdp(issuer, subject);
      if (!resolved) {
        lastError = `No active agent is bound to ${issuer} / ${subject}.`;
        continue;
      }
      if (cand.tenant !== null && resolved.tenant !== cand.tenant) {
        lastError = 'Agent/IdP tenant mismatch.';
        continue;
      }
      if (!resolved.backingUserId) {
        lastError = 'Agent has no backing identity (cannot dispatch).';
        continue;
      }
      return { ok: true, ctx: { resolved, claims: payload } };
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'verification error';
    }
  }
  return { ok: false, status: 403, error: lastError };
}
