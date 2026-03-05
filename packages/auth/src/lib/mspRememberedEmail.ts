import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const MSP_REMEMBERED_EMAIL_COOKIE = 'msp_remembered_email';
export const MSP_PENDING_REMEMBER_CONTEXT_COOKIE = 'msp_pending_remember_context';
export const MSP_REMEMBERED_EMAIL_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;
export const MSP_PENDING_REMEMBER_CONTEXT_MAX_AGE_SECONDS = 10 * 60;
const REMEMBERED_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface PendingRememberContextPayload {
  email: string;
  publicWorkstation: boolean;
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

export function normalizeRememberedEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidRememberedEmail(value: string): boolean {
  return REMEMBERED_EMAIL_PATTERN.test(value);
}

export function buildRememberedEmailCookie(email: string) {
  return {
    name: MSP_REMEMBERED_EMAIL_COOKIE,
    value: email,
    path: '/',
    maxAge: MSP_REMEMBERED_EMAIL_MAX_AGE_SECONDS,
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
  };
}

export function buildClearedRememberedEmailCookie() {
  return {
    name: MSP_REMEMBERED_EMAIL_COOKIE,
    value: '',
    path: '/',
    maxAge: 0,
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
  };
}

export function createPendingRememberContextCookie(params: {
  email: string;
  publicWorkstation: boolean;
  secret: string;
  ttlSeconds?: number;
}) {
  const normalizedEmail = normalizeRememberedEmail(params.email);
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + (params.ttlSeconds ?? MSP_PENDING_REMEMBER_CONTEXT_MAX_AGE_SECONDS);
  const payload: PendingRememberContextPayload = {
    email: normalizedEmail,
    publicWorkstation: params.publicWorkstation,
    issuedAt,
    expiresAt,
    nonce: randomBytes(12).toString('hex'),
  };
  const payloadEncoded = toBase64Url(JSON.stringify(payload));
  const signature = computeSignature(payloadEncoded, params.secret);

  return {
    value: `${payloadEncoded}.${signature}`,
    payload,
  };
}

export function parsePendingRememberContextCookie(params: {
  value: string | undefined;
  secret: string | undefined;
  now?: number;
}): PendingRememberContextPayload | null {
  if (!params.value || !params.secret) {
    return null;
  }

  const [payloadEncoded, signature] = params.value.split('.');
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
    const payload = JSON.parse(fromBase64Url(payloadEncoded)) as Partial<PendingRememberContextPayload>;
    if (
      typeof payload.email !== 'string' ||
      typeof payload.publicWorkstation !== 'boolean' ||
      typeof payload.issuedAt !== 'number' ||
      typeof payload.expiresAt !== 'number' ||
      typeof payload.nonce !== 'string'
    ) {
      return null;
    }

    const now = params.now ?? Math.floor(Date.now() / 1000);
    const normalizedEmail = normalizeRememberedEmail(payload.email);
    if (!isValidRememberedEmail(normalizedEmail) || payload.expiresAt <= now) {
      return null;
    }

    return {
      email: normalizedEmail,
      publicWorkstation: payload.publicWorkstation,
      issuedAt: payload.issuedAt,
      expiresAt: payload.expiresAt,
      nonce: payload.nonce,
    };
  } catch {
    return null;
  }
}

export function buildPendingRememberContextCookie(value: string) {
  return {
    name: MSP_PENDING_REMEMBER_CONTEXT_COOKIE,
    value,
    path: '/',
    maxAge: MSP_PENDING_REMEMBER_CONTEXT_MAX_AGE_SECONDS,
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
  };
}

export function buildClearedPendingRememberContextCookie() {
  return {
    name: MSP_PENDING_REMEMBER_CONTEXT_COOKIE,
    value: '',
    path: '/',
    maxAge: 0,
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
  };
}
