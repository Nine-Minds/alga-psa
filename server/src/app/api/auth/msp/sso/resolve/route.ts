import { NextRequest, NextResponse } from 'next/server';
import {
  MSP_SSO_DISCOVERY_COOKIE,
  MSP_SSO_GENERIC_FAILURE_MESSAGE,
  MSP_SSO_RESOLUTION_COOKIE,
  MSP_SSO_RESOLUTION_TTL_SECONDS,
} from '@alga-psa/auth/lib/sso/mspSsoResolution';
import {
  CLIENT_PORTAL_SSO_DISCOVERY_COOKIE,
  CLIENT_PORTAL_SSO_RESOLUTION_COOKIE,
} from '@alga-psa/auth/lib/sso/clientPortalSsoResolution';
import {
  buildClearedPendingRememberContextCookie,
  buildPendingRememberContextCookie,
} from '@alga-psa/auth/lib/mspRememberedEmail';
import { getRequestIpFromHeaders, resolveMspSso } from 'server/src/lib/auth/mspSsoResolve';

export const dynamic = 'force-dynamic';

function buildGenericFailureResponse(): NextResponse {
  // Anti-enumeration rule: every failure path must return the exact same response shape/message.
  const response = NextResponse.json(
    { ok: false, message: MSP_SSO_GENERIC_FAILURE_MESSAGE },
    { status: 200 }
  );
  response.cookies.set({
    name: MSP_SSO_RESOLUTION_COOKIE,
    value: '',
    path: '/',
    maxAge: 0,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
  response.cookies.set(buildClearedPendingRememberContextCookie());
  return response;
}

function clearClientPortalSsoCookies(response: NextResponse): void {
  for (const cookieName of [
    CLIENT_PORTAL_SSO_DISCOVERY_COOKIE,
    CLIENT_PORTAL_SSO_RESOLUTION_COOKIE,
  ]) {
    response.cookies.set({
      name: cookieName,
      value: '',
      path: '/',
      maxAge: 0,
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json().catch(() => null)) as
      | { provider?: unknown; email?: unknown; publicWorkstation?: unknown; callbackUrl?: unknown; tenantSlug?: unknown }
      | null;

    const result = await resolveMspSso({
      provider: body?.provider,
      email: body?.email,
      publicWorkstation: body?.publicWorkstation === true,
      callbackUrl: body?.callbackUrl,
      tenantSlug: body?.tenantSlug,
      discoveryCookieValue: request.cookies.get(MSP_SSO_DISCOVERY_COOKIE)?.value,
      ip: getRequestIpFromHeaders(request.headers),
    });
    if (!result.ok) {
      return buildGenericFailureResponse();
    }

    const response = NextResponse.json({ ok: true }, { status: 200 });
    clearClientPortalSsoCookies(response);
    response.cookies.set({
      name: MSP_SSO_RESOLUTION_COOKIE,
      value: result.resolutionCookieValue,
      path: '/',
      maxAge: MSP_SSO_RESOLUTION_TTL_SECONDS,
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });
    response.cookies.set(buildPendingRememberContextCookie(result.pendingRememberContextCookieValue));

    return response;
  } catch (error) {
    console.error('[msp-sso-resolve] unexpected failure', {
      message: error instanceof Error ? error.message : String(error),
    });
    return buildGenericFailureResponse();
  }
}
