import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Where an MSP SSO sign-in begun on a custom domain should land (alga-2026-0002996).
 *
 * The canonical-host entry point (`/api/auth/msp/sso/start`) runs the OAuth round trip on
 * the canonical host, so the custom domain the user started from cannot ride along in
 * OAuth state. It travels in this signed, host-only, short-lived cookie instead. The
 * `signIn` callback reads it once the provider has returned and hands the session to
 * `domain` through the one-time-token handoff. The cookie is only a hint: the handoff
 * itself re-checks that the domain is active, serves the MSP app and belongs to the
 * signed-in user's tenant, so a forged or stale value cannot widen access.
 */
export const MSP_SSO_HANDOFF_COOKIE = 'msp_sso_handoff';
export const MSP_SSO_HANDOFF_TTL_SECONDS = 10 * 60;

export interface MspSsoHandoffPayload {
  /** Custom domain (host, with port when it is not the default) the sign-in started on. */
  domain: string;
  /** Relative path inside the MSP app the user asked for. */
  returnPath: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
}

function toBase64Url(value: Buffer | string): string {
  return Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized + '='.repeat((4 - (normalized.length % 4)) % 4), 'base64').toString('utf8');
}

function sign(payloadEncoded: string, secret: string): string {
  return toBase64Url(createHmac('sha256', secret).update(`${MSP_SSO_HANDOFF_COOKIE}:${payloadEncoded}`).digest());
}

export function createSignedMspSsoHandoffCookie(params: {
  domain: string;
  returnPath: string;
  secret: string;
  ttlSeconds?: number;
  now?: number;
}): { value: string; payload: MspSsoHandoffPayload } {
  const now = params.now ?? Date.now();
  const payload: MspSsoHandoffPayload = {
    domain: params.domain,
    returnPath: params.returnPath,
    issuedAt: now,
    expiresAt: now + (params.ttlSeconds ?? MSP_SSO_HANDOFF_TTL_SECONDS) * 1000,
    nonce: randomBytes(16).toString('hex'),
  };
  const payloadEncoded = toBase64Url(JSON.stringify(payload));
  return { value: `${payloadEncoded}.${sign(payloadEncoded, params.secret)}`, payload };
}

export function parseAndVerifyMspSsoHandoffCookie(params: {
  value: string | undefined;
  secret: string;
  now?: number;
}): MspSsoHandoffPayload | null {
  const { value, secret } = params;
  if (!value) return null;

  const parts = value.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [payloadEncoded, signature] = parts;

  const expected = Buffer.from(sign(payloadEncoded, secret));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  let payload: MspSsoHandoffPayload;
  try {
    payload = JSON.parse(fromBase64Url(payloadEncoded)) as MspSsoHandoffPayload;
  } catch {
    return null;
  }

  if (!payload || typeof payload.domain !== 'string' || payload.domain.length === 0) return null;
  if (typeof payload.returnPath !== 'string' || !payload.returnPath.startsWith('/')) return null;
  if (typeof payload.expiresAt !== 'number' || payload.expiresAt <= (params.now ?? Date.now())) return null;
  return payload;
}
