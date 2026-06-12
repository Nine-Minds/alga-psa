import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import {
  CLIENT_PORTAL_SSO_DISCOVERY_COOKIE,
  CLIENT_PORTAL_SSO_GENERIC_FAILURE_MESSAGE,
  CLIENT_PORTAL_SSO_RESOLUTION_COOKIE,
  CLIENT_PORTAL_SSO_RESOLUTION_TTL_SECONDS,
  createSignedClientPortalSsoResolutionCookie,
  getMspSsoSigningSecret,
  isValidClientPortalResolverCallbackUrl,
  normalizeResolverEmail,
  parseAndVerifyClientPortalSsoDiscoveryCookie,
  parseResolverProvider,
  resolveClientPortalSsoTenantContext,
} from '@alga-psa/auth/lib/sso/clientPortalSsoResolution';
import {
  MSP_SSO_DISCOVERY_COOKIE,
  MSP_SSO_RESOLUTION_COOKIE,
} from '@alga-psa/auth/lib/sso/mspSsoResolution';

export const dynamic = 'force-dynamic';

const resolverRateLimiter = new RateLimiterMemory({
  points: 8,
  duration: 60,
  blockDuration: 5 * 60,
});

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getRequestIp(request: NextRequest): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const first = forwardedFor.split(',')[0]?.trim();
    if (first) return first;
  }
  return 'unknown';
}

function buildGenericFailureResponse(): NextResponse {
  const response = NextResponse.json(
    { ok: false, message: CLIENT_PORTAL_SSO_GENERIC_FAILURE_MESSAGE },
    { status: 200 }
  );
  response.cookies.set({
    name: CLIENT_PORTAL_SSO_RESOLUTION_COOKIE,
    value: '',
    path: '/',
    maxAge: 0,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
  return response;
}

function clearMspSsoCookies(response: NextResponse): void {
  for (const cookieName of [MSP_SSO_DISCOVERY_COOKIE, MSP_SSO_RESOLUTION_COOKIE]) {
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
      | {
          provider?: unknown;
          email?: unknown;
          callbackUrl?: unknown;
          tenantSlug?: unknown;
          portalDomain?: unknown;
        }
      | null;

    const provider = parseResolverProvider(body?.provider);
    const email = typeof body?.email === 'string' ? normalizeResolverEmail(body.email) : '';
    const callbackUrl = typeof body?.callbackUrl === 'string' ? body.callbackUrl.trim() : undefined;
    if (!provider || !email || !EMAIL_PATTERN.test(email) || !isValidClientPortalResolverCallbackUrl(callbackUrl)) {
      return buildGenericFailureResponse();
    }

    const ip = getRequestIp(request);
    const emailHashBucket = createHash('sha256').update(email).digest('hex').slice(0, 16);
    try {
      await resolverRateLimiter.consume(`${ip}:${emailHashBucket}`);
    } catch {
      return buildGenericFailureResponse();
    }

    const signingSecret = await getMspSsoSigningSecret();
    if (!signingSecret) return buildGenericFailureResponse();

    const discoveryCookieValue = request.cookies.get(CLIENT_PORTAL_SSO_DISCOVERY_COOKIE)?.value;
    const discovery = parseAndVerifyClientPortalSsoDiscoveryCookie({
      value: discoveryCookieValue,
      secret: signingSecret,
    });
    if (!discovery || !discovery.providers.includes(provider)) {
      return buildGenericFailureResponse();
    }

    if (discovery.callbackUrl && callbackUrl !== discovery.callbackUrl) {
      return buildGenericFailureResponse();
    }

    const tenantContext = await resolveClientPortalSsoTenantContext({
      tenantSlug: typeof body?.tenantSlug === 'string' ? body.tenantSlug : undefined,
      portalDomain: typeof body?.portalDomain === 'string' ? body.portalDomain : undefined,
      callbackUrl,
    });
    if (!tenantContext.tenantId || tenantContext.tenantId !== discovery.tenantId) {
      return buildGenericFailureResponse();
    }

    const cookie = createSignedClientPortalSsoResolutionCookie({
      tenantId: discovery.tenantId,
      provider,
      secret: signingSecret,
      ttlSeconds: CLIENT_PORTAL_SSO_RESOLUTION_TTL_SECONDS,
    });
    const response = NextResponse.json({ ok: true }, { status: 200 });
    clearMspSsoCookies(response);
    response.cookies.set({
      name: CLIENT_PORTAL_SSO_RESOLUTION_COOKIE,
      value: cookie.value,
      path: '/',
      maxAge: CLIENT_PORTAL_SSO_RESOLUTION_TTL_SECONDS,
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });
    return response;
  } catch {
    return buildGenericFailureResponse();
  }
}
