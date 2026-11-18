/**
 * Redirect URIs the mobile app hands to the web auth pages. Only the app's own
 * schemes are honoured, and only its two auth landing paths:
 *
 * - `auth/callback`: the sign-in handoff returns here with a one-time token.
 * - `auth/signed-out`: the web sign-out returns here with nothing; the app
 *   ignores the link, it only needs the browser session to close.
 */
export type MobileRedirectKind = 'callback' | 'signed-out';

const ALLOWED_SCHEMES = new Set(['alga', 'exp', 'https']);

const PATHS: Record<MobileRedirectKind, { host: string; path: string; suffix: string }> = {
  callback: { host: 'auth', path: '/callback', suffix: '/auth/callback' },
  'signed-out': { host: 'auth', path: '/signed-out', suffix: '/auth/signed-out' },
};

export function validateMobileRedirectUri(raw: string, kind: MobileRedirectKind): URL | null {
  try {
    const url = new URL(raw);
    const scheme = url.protocol.replace(':', '').toLowerCase();
    if (!ALLOWED_SCHEMES.has(scheme)) return null;

    const expected = PATHS[kind];
    const matches =
      (url.host === expected.host && url.pathname === expected.path) || url.pathname.endsWith(expected.suffix);
    return matches ? url : null;
  } catch {
    return null;
  }
}
