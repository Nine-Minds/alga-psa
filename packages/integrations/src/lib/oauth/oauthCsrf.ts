import crypto from 'crypto';

// Shared helpers for the OAuth "double-submit" CSRF pattern used by the
// integration connect/callback routes: the connect route sets a random token
// in an HttpOnly cookie scoped to the callback path and also embeds it in the
// OAuth state parameter; the callback verifies the two match. Only the browser
// that initiated the flow holds the cookie, so a forged or replayed callback
// URL fails the check.

export function generateOauthCsrfToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function oauthCsrfTokensMatch(expected: string, provided: string): boolean {
  if (typeof expected !== 'string' || typeof provided !== 'string') {
    return false;
  }
  const expectedBuffer = Buffer.from(expected, 'utf-8');
  const providedBuffer = Buffer.from(provided, 'utf-8');
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

export interface OauthCsrfCookieConfig {
  name: string;
  path: string;
  ttlSeconds: number;
}

export function buildOauthCsrfCookieOptions(
  config: OauthCsrfCookieConfig,
  { clear = false }: { clear?: boolean } = {}
) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: config.path,
    maxAge: clear ? 0 : config.ttlSeconds,
  };
}
