import { redirectToAppPath } from '@alga-psa/core/redirectToAppPath';
import { NextRequest, NextResponse } from 'next/server';
import { getSessionCookieName } from '@alga-psa/auth';
import { validateMobileRedirectUri } from '@/lib/mobileAuth/redirectUri';

// Auth.js session cookie names, with or without the secure prefix, the dev
// port suffix (`authjs-port-3000.session-token`), or chunk suffixes (`.0`,
// `.1`, …) for large tokens.
const SESSION_COOKIE_RE = /^(__Secure-)?authjs(-port-\d+)?\.session-token/;

export function sessionCookieNamesToClear(presentCookieNames: string[]): string[] {
  const names = new Set<string>([getSessionCookieName()]);
  for (const name of presentCookieNames) {
    if (SESSION_COOKIE_RE.test(name)) names.add(name);
  }
  return [...names];
}

/**
 * Ends the web session the mobile app's sign-in browser holds, then returns
 * to the app. The app calls this on logout: revoking its own token is not
 * enough, because the next sign-in would otherwise find the browser still
 * signed in and hand the same user straight back.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const redirectParam = url.searchParams.get('redirect');
  const redirectUrl = redirectParam ? validateMobileRedirectUri(redirectParam, 'signed-out') : null;

  // Back to the app's own scheme when the redirect is valid; otherwise to sign-in via a
  // relative Location: the request's own origin is the internal upstream (localhost:3000) on hosted.
  const response = redirectUrl
    ? NextResponse.redirect(redirectUrl.toString(), { status: 302 })
    : redirectToAppPath('/auth/signin', { status: 302 });

  for (const name of sessionCookieNamesToClear(req.cookies.getAll().map((cookie) => cookie.name))) {
    response.cookies.set(name, '', {
      path: '/',
      maxAge: 0,
      httpOnly: true,
      sameSite: 'lax',
      secure: name.startsWith('__Secure-'),
    });
  }
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
