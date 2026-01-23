/**
 * Session cookie management and JWT encoding utilities for Alga PSA authentication.
 * Built on top of @auth/core for NextAuth compatibility.
 */

import { encode } from '@auth/core/jwt';
import type { CookieOption } from '@auth/core/types';

const DEFAULT_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24; // 24 hours

let cachedSecret: string | null = null;
let warnedAboutFallbackSecret = false;

function getFallbackNextAuthSecret(): string {
  const source =
    process.env.NEXTAUTH_URL ??
    process.env.APP_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    'http://localhost';

  return `insecure-dev-nextauth-secret:${source}`;
}

function shouldRequireNextAuthSecret(): boolean {
  return Boolean(process.env.CI);
}

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

export function getSessionMaxAge(): number {
  const raw = process.env.NEXTAUTH_SESSION_EXPIRES;
  if (!raw) {
    return DEFAULT_SESSION_MAX_AGE_SECONDS;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? DEFAULT_SESSION_MAX_AGE_SECONDS : parsed;
}

export function getSessionCookieName(): string {
  const baseName = process.env.NODE_ENV === 'production'
    ? '__Secure-authjs.session-token'
    : 'authjs.session-token';

  const portSuffix = getDevCookiePortSuffix();
  if (!portSuffix) {
    return baseName;
  }

  return `${baseName}.${portSuffix}`;
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

  const envSecret = process.env.NEXTAUTH_SECRET;
  if (!envSecret) {
    if (shouldRequireNextAuthSecret()) {
      throw new Error('NEXTAUTH_SECRET is not configured.');
    }

    if (!warnedAboutFallbackSecret) {
      console.warn(
        '[auth] NEXTAUTH_SECRET is not configured; using an insecure development fallback secret.',
      );
      warnedAboutFallbackSecret = true;
    }

    cachedSecret = getFallbackNextAuthSecret();
    return cachedSecret;
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
    if (shouldRequireNextAuthSecret()) {
      throw new Error('NEXTAUTH_SECRET environment variable is required for edge auth.');
    }

    if (!warnedAboutFallbackSecret) {
      console.warn(
        '[auth] NEXTAUTH_SECRET is not configured; using an insecure development fallback secret.',
      );
      warnedAboutFallbackSecret = true;
    }

    cachedSecret = getFallbackNextAuthSecret();
    return cachedSecret;
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
  session_id?: string | null;
  login_method?: string | null;
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

export function clearCachedSecret(): void {
  cachedSecret = null;
}
