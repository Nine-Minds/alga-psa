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
