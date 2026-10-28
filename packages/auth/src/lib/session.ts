/**
 * @alga-psa/auth - Session Utilities
 *
 * Session cookie management and JWT encoding utilities for AlgaPSA authentication.
 * Built on top of @auth/core for NextAuth compatibility.
 */

import { encode } from '@auth/core/jwt';
import type { CookieOption } from '@auth/core/types';

const DEFAULT_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24; // 24 hours

let cachedSecret: string | null = null;

/**
 * Everything the auth cookie names depend on. The runtime reads it from
 * `process.env` (`readSessionCookieEnvironment`); anything else that has to
 * write or read an Alga session cookie (test helpers, smoke tools) builds one
 * of these and calls the same functions, so no consumer re-derives the name.
 */
export interface SessionCookieEnvironment {
  nodeEnv?: string;
  /** Decides `__Secure-` in production together with `nodeEnv`. */
  nextAuthUrl?: string;
  /** Public URLs in precedence order; the first one that parses is authoritative. */
  publicUrls: Array<string | undefined>;
  /** Listener port; only consulted outside production when no public URL parses. */
  listenerPort?: string | null;
}

export function readSessionCookieEnvironment(): SessionCookieEnvironment {
  return {
    nodeEnv: process.env.NODE_ENV,
    nextAuthUrl: process.env.NEXTAUTH_URL,
    publicUrls: [
      process.env.NEXTAUTH_URL,
      process.env.APP_URL,
      process.env.NEXT_PUBLIC_APP_URL,
    ],
    listenerPort:
      process.env.PORT ?? process.env.APP_PORT ?? process.env.EXPOSE_SERVER_PORT ?? null,
  };
}

function cookiePortSuffixFor(env: SessionCookieEnvironment): string | null {
  for (const candidate of env.publicUrls) {
    if (!candidate) continue;
    try {
      // The first valid public URL is authoritative. A portless URL means
      // the browser uses the scheme's standard port, even when a reverse
      // proxy forwards to an internal listener such as PORT=3000.
      return new URL(candidate).port || null;
    } catch {
      // Ignore invalid URLs and fall through to the next public URL.
    }
  }

  // A production listener port is an implementation detail. Only development
  // runtimes without a public URL need PORT to keep worktree cookies separate.
  if (env.nodeEnv === 'production') {
    return null;
  }

  return env.listenerPort && env.listenerPort.length > 0 ? env.listenerPort : null;
}

/**
 * Cookies are shared across ports. Scope each explicitly-port-bound runtime's
 * auth cookies to its port. Auth.js reads every cookie whose name starts with
 * its session-cookie name as a token chunk, not only `.0`/`.1` chunks. Put
 * the port marker before the `authjs` cookie name so another runtime cannot
 * consume or clear this runtime's session cookie.
 */
export function portScopedCookieNameFor(cookieName: string, env: SessionCookieEnvironment): string {
  const portSuffix = cookiePortSuffixFor(env);
  if (!portSuffix) {
    return cookieName;
  }

  const authCookiePrefix = cookieName.match(/^(__Secure-|__Host-)?authjs\.(.*)$/);
  if (authCookiePrefix) {
    const [, securityPrefix = '', cookieNameRemainder] = authCookiePrefix;
    return `${securityPrefix}authjs-port-${portSuffix}.${cookieNameRemainder}`;
  }

  return `${cookieName}-port-${portSuffix}`;
}

export function isSecureCookieEnvironmentFor(env: SessionCookieEnvironment): boolean {
  return env.nodeEnv === 'production'
    && (!env.nextAuthUrl || env.nextAuthUrl.startsWith('https://'));
}

/**
 * The session cookie name. Auth.js also uses it as the JWT salt, so a token
 * minted for this cookie must be encoded with exactly this string.
 */
export function sessionCookieNameFor(env: SessionCookieEnvironment): string {
  const baseName = isSecureCookieEnvironmentFor(env)
    ? '__Secure-authjs.session-token'
    : 'authjs.session-token';

  return portScopedCookieNameFor(baseName, env);
}

export function withDevPortSuffix(cookieName: string): string {
  return portScopedCookieNameFor(cookieName, readSessionCookieEnvironment());
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
export function isSecureCookieEnvironment(): boolean {
  return isSecureCookieEnvironmentFor(readSessionCookieEnvironment());
}

export function getSessionCookieName(): string {
  return sessionCookieNameFor(readSessionCookieEnvironment());
}

/**
 * Get the session cookie configuration.
 *
 * Browsers hosting the PSA inside a Microsoft Teams iframe treat the session
 * cookie as third-party. With the default `SameSite=Lax` the browser refuses
 * to send it from the Teams iframe, so every navigation inside the tab looks
 * unauthenticated even though sign-in succeeded. Operators that need the
 * Teams personal tab to work set `TEAMS_IFRAME_SESSION_COOKIE=true` on the
 * deployment, which relaxes the session cookie to `SameSite=None; Secure`.
 * The cookie still requires HTTPS and carries the `__Secure-` prefix.
 */
export function getSessionCookieConfig(): CookieOption {
  const secure = isSecureCookieEnvironment();
  const crossSiteAllowed = process.env.TEAMS_IFRAME_SESSION_COOKIE === 'true';
  const sameSite: CookieOption['options']['sameSite'] =
    crossSiteAllowed && secure ? 'none' : 'lax';

  return {
    name: getSessionCookieName(),
    options: {
      httpOnly: true,
      sameSite,
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
