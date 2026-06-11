import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';

export const QBO_OAUTH_STATE_COOKIE = 'alga_qbo_oauth_state';
export const QBO_OAUTH_STATE_MAX_AGE_SECONDS = 10 * 60;
const QBO_OAUTH_STATE_COOKIE_PATH = '/api/integrations/qbo';

export interface QboOAuthStatePayload {
  tenantId: string;
  csrf: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
}

function toBase64Url(value: Buffer | string): string {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const withPadding = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(withPadding, 'base64').toString('utf8');
}

function computeSignature(payloadEncoded: string, secret: string): string {
  return toBase64Url(createHmac('sha256', secret).update(payloadEncoded).digest());
}

export async function getQboStateSigningSecret(): Promise<string | null> {
  const fromEnv = process.env.NEXTAUTH_SECRET?.trim();
  if (fromEnv) return fromEnv;

  const secretProvider = await getSecretProviderInstance();
  const fromAppSecret = (await secretProvider.getAppSecret('NEXTAUTH_SECRET'))?.trim();
  return fromAppSecret || null;
}

export function createQboOAuthState(params: {
  tenantId: string;
  secret: string;
  ttlSeconds?: number;
}): { stateParam: string; cookieValue: string; payload: QboOAuthStatePayload } {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + (params.ttlSeconds ?? QBO_OAUTH_STATE_MAX_AGE_SECONDS);
  const payload: QboOAuthStatePayload = {
    tenantId: params.tenantId,
    csrf: randomBytes(24).toString('hex'),
    issuedAt,
    expiresAt,
    nonce: randomBytes(12).toString('hex'),
  };

  const stateParam = toBase64Url(JSON.stringify({ tenantId: payload.tenantId, csrf: payload.csrf }));
  const payloadEncoded = toBase64Url(JSON.stringify(payload));
  const signature = computeSignature(payloadEncoded, params.secret);

  return {
    stateParam,
    cookieValue: `${payloadEncoded}.${signature}`,
    payload,
  };
}

export function validateQboOAuthState(params: {
  stateParam: string | null | undefined;
  cookieValue: string | undefined;
  secret: string | undefined;
  now?: number;
}): QboOAuthStatePayload | null {
  if (!params.stateParam || !params.cookieValue || !params.secret) {
    return null;
  }

  const [payloadEncoded, signature] = params.cookieValue.split('.');
  if (!payloadEncoded || !signature) {
    return null;
  }

  const expectedSignature = computeSignature(payloadEncoded, params.secret);
  const expectedBuffer = Buffer.from(expectedSignature);
  const actualBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== actualBuffer.length) {
    return null;
  }
  if (!timingSafeEqual(expectedBuffer, actualBuffer)) {
    return null;
  }

  try {
    const payload = JSON.parse(fromBase64Url(payloadEncoded)) as Partial<QboOAuthStatePayload>;
    if (
      typeof payload.tenantId !== 'string' ||
      typeof payload.csrf !== 'string' ||
      typeof payload.issuedAt !== 'number' ||
      typeof payload.expiresAt !== 'number' ||
      typeof payload.nonce !== 'string'
    ) {
      return null;
    }

    const now = params.now ?? Math.floor(Date.now() / 1000);
    if (payload.expiresAt <= now) {
      return null;
    }

    const state = JSON.parse(fromBase64Url(params.stateParam)) as Partial<{ tenantId: string; csrf: string }>;
    if (state.tenantId !== payload.tenantId || state.csrf !== payload.csrf) {
      return null;
    }

    return {
      tenantId: payload.tenantId,
      csrf: payload.csrf,
      issuedAt: payload.issuedAt,
      expiresAt: payload.expiresAt,
      nonce: payload.nonce,
    };
  } catch {
    return null;
  }
}

export function buildQboOAuthStateCookie(value: string) {
  return {
    name: QBO_OAUTH_STATE_COOKIE,
    value,
    path: QBO_OAUTH_STATE_COOKIE_PATH,
    maxAge: QBO_OAUTH_STATE_MAX_AGE_SECONDS,
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
  };
}

export function buildClearedQboOAuthStateCookie() {
  return {
    name: QBO_OAUTH_STATE_COOKIE,
    value: '',
    path: QBO_OAUTH_STATE_COOKIE_PATH,
    maxAge: 0,
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
  };
}
