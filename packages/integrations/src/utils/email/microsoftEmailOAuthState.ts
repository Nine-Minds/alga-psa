/**
 * Signed OAuth state for the Microsoft inbound-email mailbox flow.
 *
 * The state carries the complete non-secret selection context (tenant,
 * provider, issuer choice, client ID, nonce, purpose) and is HMAC-signed so the
 * callback can reject tampered, stale, or replayed authorization requests. It
 * never contains a client secret or a secret reference.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import type { MicrosoftEmailIssuerChoice } from '../../lib/microsoftEmailIssuerSelection';

export type MicrosoftEmailOAuthPurpose = 'create' | 'reconnect';

export interface MicrosoftEmailOAuthStatePayload {
  purpose: MicrosoftEmailOAuthPurpose;
  tenant: string;
  userId: string;
  providerId?: string;
  issuerKind: 'managed' | 'profile';
  issuerProfileId?: string;
  clientId: string;
  redirectUri: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
}

export const MICROSOFT_EMAIL_OAUTH_STATE_TTL_SECONDS = 10 * 60;

function toBase64Url(value: Buffer | string): string {
  return Buffer.from(value).toString('base64url');
}

function fromBase64Url(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function signPayload(payloadEncoded: string, secret: string): string {
  return toBase64Url(createHmac('sha256', secret).update(payloadEncoded).digest());
}

/** Resolve the state-signing secret (NextAuth secret with env fallback). */
export async function getMicrosoftEmailOAuthSigningSecret(): Promise<string | null> {
  const fromEnv = process.env.NEXTAUTH_SECRET?.trim();
  if (fromEnv) return fromEnv;

  try {
    const secretProvider = await getSecretProviderInstance();
    const fromAppSecret = (await secretProvider.getAppSecret('NEXTAUTH_SECRET'))?.trim();
    return fromAppSecret || null;
  } catch {
    return null;
  }
}

export function createMicrosoftEmailOAuthState(input: {
  purpose: MicrosoftEmailOAuthPurpose;
  tenant: string;
  userId: string;
  providerId?: string;
  issuer: MicrosoftEmailIssuerChoice;
  clientId: string;
  redirectUri: string;
  secret: string;
  ttlSeconds?: number;
}): { token: string; payload: MicrosoftEmailOAuthStatePayload } {
  if (!input.secret.trim()) {
    throw new Error('Microsoft email OAuth state signing secret is not configured');
  }

  const issuedAt = Math.floor(Date.now() / 1000);
  const payload: MicrosoftEmailOAuthStatePayload = {
    purpose: input.purpose,
    tenant: input.tenant,
    userId: input.userId,
    ...(input.providerId ? { providerId: input.providerId } : {}),
    issuerKind: input.issuer.kind,
    ...(input.issuer.kind === 'profile' && input.issuer.profileId
      ? { issuerProfileId: input.issuer.profileId }
      : {}),
    clientId: input.clientId,
    redirectUri: new URL(input.redirectUri).toString(),
    nonce: randomBytes(24).toString('hex'),
    issuedAt,
    expiresAt: issuedAt + (input.ttlSeconds ?? MICROSOFT_EMAIL_OAUTH_STATE_TTL_SECONDS),
  };
  const payloadEncoded = toBase64Url(JSON.stringify(payload));
  return {
    token: `${payloadEncoded}.${signPayload(payloadEncoded, input.secret)}`,
    payload,
  };
}

/**
 * Verify a signed Microsoft email OAuth state. Returns the payload when the
 * signature is valid, the shape is intact, and the token has not expired.
 */
export function validateMicrosoftEmailOAuthState(input: {
  token: string | null | undefined;
  secret: string | null | undefined;
  now?: number;
}): MicrosoftEmailOAuthStatePayload | null {
  if (!input.token || !input.secret) return null;

  const [payloadEncoded, signature, extra] = input.token.split('.');
  if (!payloadEncoded || !signature || extra) return null;

  const expected = Buffer.from(signPayload(payloadEncoded, input.secret));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return null;
  }

  try {
    const payload = JSON.parse(fromBase64Url(payloadEncoded)) as Partial<MicrosoftEmailOAuthStatePayload>;
    if (
      (payload.purpose !== 'create' && payload.purpose !== 'reconnect') ||
      typeof payload.tenant !== 'string' ||
      typeof payload.userId !== 'string' ||
      (payload.issuerKind !== 'managed' && payload.issuerKind !== 'profile') ||
      typeof payload.clientId !== 'string' ||
      typeof payload.redirectUri !== 'string' ||
      typeof payload.nonce !== 'string' ||
      typeof payload.issuedAt !== 'number' ||
      typeof payload.expiresAt !== 'number'
    ) {
      return null;
    }
    if (payload.issuerKind === 'profile' && typeof payload.issuerProfileId !== 'string') {
      return null;
    }

    new URL(payload.redirectUri);
    const now = input.now ?? Math.floor(Date.now() / 1000);
    if (payload.issuedAt > now + 60 || payload.expiresAt <= now) return null;

    return payload as MicrosoftEmailOAuthStatePayload;
  } catch {
    return null;
  }
}
