import { encode } from '@auth/core/jwt';
import User from '@alga-psa/db/models/user';
import {
  buildClearedPendingRememberContextCookie,
  buildClearedRememberedEmailCookie,
  buildRememberedEmailCookie,
  MSP_PENDING_REMEMBER_CONTEXT_COOKIE,
  parsePendingRememberContextCookie,
} from '@alga-psa/auth/lib/mspRememberedEmail';
import {
  buildSessionCookie,
  getSessionCookieConfig,
  getSessionMaxAge,
} from '@alga-psa/auth/lib/session';
import {
  MSP_SSO_HANDOFF_COOKIE,
  parseAndVerifyMspSsoHandoffCookie,
} from '@alga-psa/auth/lib/sso/mspSsoHandoff';
import { computeVanityRedirect } from '@alga-psa/auth/lib/portalDomainHandoff';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function buildErrorRedirect(request: NextRequest): NextResponse {
  return NextResponse.redirect(new URL('/api/auth/error?error=AccessDenied', request.nextUrl));
}

function isAllowedCallbackUrl(value: string | null): boolean {
  if (!value) {
    return true;
  }

  const trimmed = value.trim();
  return trimmed.startsWith('/');
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (process.env.PLAYWRIGHT_FAKE_GOOGLE_OAUTH !== 'true') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const callbackUrl = request.nextUrl.searchParams.get('callbackUrl');
  if (!isAllowedCallbackUrl(callbackUrl)) {
    return buildErrorRedirect(request);
  }

  const signingSecret = process.env.NEXTAUTH_SECRET;
  const pendingValue = request.cookies.get(MSP_PENDING_REMEMBER_CONTEXT_COOKIE)?.value;
  const pendingContext = parsePendingRememberContextCookie({
    value: pendingValue,
    secret: signingSecret,
  });

  if (!pendingContext || !signingSecret) {
    const response = buildErrorRedirect(request);
    response.cookies.set(buildClearedPendingRememberContextCookie());
    return response;
  }

  const user = await User.findUserByEmailAndType(pendingContext.email, 'internal');
  if (!user?.user_id || !user.tenant) {
    const response = buildErrorRedirect(request);
    response.cookies.set(buildClearedPendingRememberContextCookie());
    return response;
  }

  // A sign-in begun on a custom MSP domain (see /api/auth/msp/sso/start) is handed back to it,
  // as the real OAuth callback does in the NextAuth signIn callback.
  const handoff = parseAndVerifyMspSsoHandoffCookie({
    value: request.cookies.get(MSP_SSO_HANDOFF_COOKIE)?.value,
    secret: signingSecret,
  });
  if (handoff && process.env.NEXTAUTH_URL) {
    const protocol = new URL(process.env.NEXTAUTH_URL).protocol;
    const vanityRedirect = await computeVanityRedirect({
      url: `${protocol}//${handoff.domain}${handoff.returnPath}`,
      baseUrl: process.env.NEXTAUTH_URL,
      token: { id: user.user_id, tenant: user.tenant, user_type: 'internal', login_method: 'google' },
    });
    if (vanityRedirect) {
      const handoffResponse = NextResponse.redirect(vanityRedirect);
      handoffResponse.cookies.set({ name: MSP_SSO_HANDOFF_COOKIE, value: '', path: '/', maxAge: 0 });
      handoffResponse.cookies.set(buildClearedPendingRememberContextCookie());
      return handoffResponse;
    }
  }

  const sessionCookie = getSessionCookieConfig();
  const sessionToken = await encode({
    token: {
      id: user.user_id,
      sub: user.user_id,
      email: user.email,
      name: [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || user.email,
      username: user.username || user.email,
      proToken: user.hashed_password || 'playwright-mock-token',
      tenant: user.tenant,
      user_type: 'internal',
    },
    secret: signingSecret,
    maxAge: getSessionMaxAge(),
    salt: sessionCookie.name,
  });

  const response = NextResponse.redirect(
    new URL(callbackUrl || '/msp/dashboard', request.nextUrl),
  );
  response.cookies.set(buildSessionCookie(sessionToken));
  response.cookies.set(buildClearedPendingRememberContextCookie());

  if (pendingContext.publicWorkstation) {
    response.cookies.set(buildClearedRememberedEmailCookie());
  } else {
    response.cookies.set(buildRememberedEmailCookie(pendingContext.email));
  }

  return response;
}
