/**
 * @alga-psa/auth - Session Utilities
 *
 * Session cookie management and JWT encoding utilities for Alga PSA authentication.
 * Built on top of @auth/core for NextAuth compatibility.
 */

import { encode } from '@auth/core/jwt';
import type { CookieOption } from '@auth/core/types';

const DEFAULT_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24; // 24 hours

let cachedSecret: string | null = null;

function getDevCookiePortSuffix(): string | null {
  if (process.env.NODE_ENV === 'production') {
    return null;
  }

  const urlCandidates = [
    process.env.NEXTAUTH_URL,
    process.env.APP_URL,
    process.env.NEXT_PUBLIC_APP_URL,
  ].filter(Boolean) as string[];

  for (const candidate of urlCandidates) {
    try {
      const parsed = new URL(candidate);
      if (parsed.port) {
        return parsed.port;
      }
    } catch {
      // Ignore invalid URLs and fall through to other candidates.
    }
  }

  const portCandidate =
    process.env.PORT ?? process.env.APP_PORT ?? process.env.EXPOSE_SERVER_PORT ?? null;
  return portCandidate && portCandidate.length > 0 ? portCandidate : null;
}

/**
 * Cookies are shared across localhost ports. In development, suffix cookie names with the dev port
 * so multiple worktrees (each with their own NEXTAUTH_SECRET) can coexist without clobbering.
 */
export function withDevPortSuffix(cookieName: string): string {
  const portSuffix = getDevCookiePortSuffix();
  if (!portSuffix) {
    return cookieName;
  }

  return `${cookieName}.${portSuffix}`;
}

/**
 * Get the session max age in seconds
 */
export function getSessionMaxAge(): number {
  const raw = process.env.NEXTAUTH_SESSION_EXPIRES;
  if (!raw) {
    return DEFAULT_SESSION_MAX_AGE_SECONDS;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? DEFAULT_SESSION_MAX_AGE_SECONDS : parsed;
}

/**
 * Get the session cookie name (environment-aware with port suffix for dev)
 */
export function getSessionCookieName(): string {
  const baseName = process.env.NODE_ENV === 'production'
    ? '__Secure-authjs.session-token'
    : 'authjs.session-token';

  return withDevPortSuffix(baseName);
}

/**
 * Get the session cookie configuration
 */
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

/**
 * Get the NextAuth secret (async with caching)
 */
export async function getNextAuthSecret(): Promise<string> {
  if (cachedSecret) {
    return cachedSecret;
  }

  const envSecret = process.env.NEXTAUTH_SECRET;
  if (!envSecret) {
    throw new Error('NEXTAUTH_SECRET is not configured.');
  }

  cachedSecret = envSecret;
  return envSecret;
}

/**
 * Get the NextAuth secret synchronously (for edge runtime)
 */
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

/**
 * Portal session token payload interface
 */
export interface PortalSessionTokenPayload {
  id: string;
  email?: string | null;
  name?: string | null;
  tenant?: string | null;
  user_type?: string | null;
  clientId?: string | null;
  contactId?: string | null;
  roles?: string[] | null;
  session_id?: string | null;
  login_method?: string | null;
  [key: string]: unknown;
}

/**
 * Encode a portal session token
 */
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

/**
 * Build a session cookie object
 */
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

/**
 * Clear the cached secret (useful for testing)
 */
export function clearCachedSecret(): void {
  cachedSecret = null;
}
