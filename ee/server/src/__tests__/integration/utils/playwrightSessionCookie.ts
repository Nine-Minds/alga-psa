import { readSessionCookieEnvironment, sessionCookieNameFor } from '@alga-psa/auth/session';

/**
 * The session cookie name (and Auth.js JWT salt) the app under test reads.
 * Derived by the runtime's own function from the same environment; the
 * Playwright base URL only counts when no public URL is configured.
 */
export function playwrightSessionCookieName(baseUrl: string): string {
  const env = readSessionCookieEnvironment();
  return sessionCookieNameFor({ ...env, publicUrls: [...env.publicUrls, baseUrl] });
}
