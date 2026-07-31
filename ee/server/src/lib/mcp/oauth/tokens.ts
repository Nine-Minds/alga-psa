import crypto from 'node:crypto';
import { SignJWT, jwtVerify, decodeProtectedHeader, type JWTPayload } from 'jose';
import { getActiveSigningKey, getVerificationKey } from './keys';

/**
 * AlgaPSA-issued MCP access tokens. Short-lived, asymmetric-signed JWTs whose
 * subject is the AlgaPSA user the token acts as. The audience is bound to the MCP
 * resource (RFC 8707). Access tokens are stateless; revocation is enforced at the
 * resource server by checking the referenced grant is not revoked (see grants.ts).
 */

export const ACCESS_TOKEN_TTL_SECONDS = 600; // 10 minutes
export const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
export const AUTH_CODE_TTL_SECONDS = 60;
export const MCP_SCOPE = 'mcp';

/** The canonical MCP resource (token audience) for a given public base URL. */
export function mcpResource(base: string): string {
  return `${base.replace(/\/$/, '')}/api/mcp`;
}

export interface AccessTokenClaims {
  userId: string;
  tenant: string;
  clientId: string;
  grantId: string;
  scope: string;
  jti: string;
}

export async function mintAccessToken(params: {
  base: string;
  tenant: string;
  userId: string;
  clientId: string;
  grantId: string;
  scope?: string;
  ttlSeconds?: number;
}): Promise<string> {
  const base = params.base.replace(/\/$/, '');
  const { kid, alg, privateKey } = await getActiveSigningKey();
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    tenant: params.tenant,
    client_id: params.clientId,
    grant_id: params.grantId,
    scope: params.scope ?? MCP_SCOPE,
  })
    .setProtectedHeader({ alg, kid, typ: 'at+jwt' })
    .setIssuer(base)
    .setSubject(params.userId)
    .setAudience(mcpResource(base))
    .setIssuedAt(now)
    .setExpirationTime(now + (params.ttlSeconds ?? ACCESS_TOKEN_TTL_SECONDS))
    .setJti(crypto.randomUUID())
    .sign(privateKey);
}

/**
 * Verify an AlgaPSA-issued access token (signature, issuer, audience, expiry).
 * Returns the parsed claims, or null if the token is not a valid Alga MCP token.
 * NOTE: callers MUST additionally check grant revocation (see grants.ts).
 */
export async function verifyAccessToken(params: {
  token: string;
  base: string;
}): Promise<AccessTokenClaims | null> {
  const base = params.base.replace(/\/$/, '');
  let header: { kid?: string };
  try {
    header = decodeProtectedHeader(params.token);
  } catch {
    return null;
  }
  if (!header.kid) return null;
  const key = await getVerificationKey(header.kid);
  if (!key) return null;
  try {
    const { payload } = await jwtVerify(params.token, key, {
      issuer: base,
      audience: mcpResource(base),
    });
    return claimsFrom(payload);
  } catch {
    return null;
  }
}

/** Cheap pre-check: is this bearer an Alga-issued MCP token (vs IdP JWT / API key)? */
export function looksLikeAlgaToken(token: string): boolean {
  try {
    return decodeProtectedHeader(token).typ === 'at+jwt';
  } catch {
    return false;
  }
}

function claimsFrom(payload: JWTPayload): AccessTokenClaims | null {
  const userId = typeof payload.sub === 'string' ? payload.sub : '';
  const tenant = typeof payload.tenant === 'string' ? payload.tenant : '';
  const clientId = typeof payload.client_id === 'string' ? payload.client_id : '';
  const grantId = typeof payload.grant_id === 'string' ? payload.grant_id : '';
  const scope = typeof payload.scope === 'string' ? payload.scope : MCP_SCOPE;
  const jti = typeof payload.jti === 'string' ? payload.jti : '';
  if (!userId || !tenant || !clientId || !grantId) return null;
  return { userId, tenant, clientId, grantId, scope, jti };
}
