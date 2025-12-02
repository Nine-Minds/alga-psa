import { encode } from '@auth/core/jwt';
import type { CookieOption } from '@auth/core/types';

const DEFAULT_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24; // 24 hours

let cachedSecret: string | null = null;

export function getSessionMaxAge(): number {
  const raw = process.env.NEXTAUTH_SESSION_EXPIRES;
  if (!raw) {
    return DEFAULT_SESSION_MAX_AGE_SECONDS;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? DEFAULT_SESSION_MAX_AGE_SECONDS : parsed;
}

export function getSessionCookieName(): string {
  return process.env.NODE_ENV === 'production'
    ? '__Secure-authjs.session-token'
    : 'authjs.session-token';
}

export function getSessionCookieConfig(): CookieOption {
  const environment = process.env.NODE_ENV ?? 'development';
  const secure = environment === 'production';

  return {
    name: getSessionCookieName(),
    options: {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure,
    },
  };
}

export async function getNextAuthSecret(): Promise<string> {
  if (cachedSecret) {
    return cachedSecret;
  }

  // try {
  //   const { getSecretProviderInstance } = await import('@alga-psa/shared/core/secretProvider');
  //   const provider = await getSecretProviderInstance();
  //   const secret = await provider.getAppSecret('NEXTAUTH_SECRET');

  //   if (secret) {
  //     cachedSecret = secret;
  //     return secret;
  //   }
  // } catch (error) {
  //   // Fallback to environment variable if secret provider is unavailable
  //   console.warn('[auth] Falling back to NEXTAUTH_SECRET from environment', {
  //     error: error instanceof Error ? error.message : 'unknown',
  //   });
  // }

  const envSecret = process.env.NEXTAUTH_SECRET;
  if (!envSecret) {
    throw new Error('NEXTAUTH_SECRET is not configured.');
  }

  cachedSecret = envSecret;
  return envSecret;
}

export function getNextAuthSecretSync(): string {
  if (cachedSecret) {
    return cachedSecret;
  }

  const envSecret = process.env.NEXTAUTH_SECRET;
  if (!envSecret) {
    throw new Error('NEXTAUTH_SECRET environment variable is required for edge auth.');
  }

  cachedSecret = envSecret;
  return envSecret;
}

export interface PortalSessionTokenPayload {
  id: string;
  email?: string | null;
  name?: string | null;
  tenant?: string | null;
  user_type?: string | null;
  clientId?: string | null;
  contactId?: string | null;
  roles?: string[] | null;
  session_id?: string | null; // NEW: Preserve session ID across domain handoff
  login_method?: string | null; // NEW: Preserve login method
  [key: string]: unknown;
}

export async function encodePortalSessionToken(payload: PortalSessionTokenPayload): Promise<string> {
  const secret = await getNextAuthSecret();
  const maxAge = getSessionMaxAge();
  const salt = getSessionCookieName();
  const issuedAt = Math.floor(Date.now() / 1000);

  const token = {
    ...payload,
    sub: payload.id,
    iat: issuedAt,
    exp: issuedAt + maxAge,
  };

  return encode({ token, secret, maxAge, salt });
}

export function buildSessionCookie(value: string): {
  name: string;
  value: string;
  maxAge: number;
  options: CookieOption['options'];
} {
  const config = getSessionCookieConfig();
  const maxAge = getSessionMaxAge();

  return {
    name: config.name,
    value,
    maxAge,
    options: config.options,
  };
}
