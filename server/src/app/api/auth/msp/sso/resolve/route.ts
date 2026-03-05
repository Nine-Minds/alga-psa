import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import {
  MSP_SSO_DISCOVERY_COOKIE,
  MSP_SSO_GENERIC_FAILURE_MESSAGE,
  MSP_SSO_RESOLUTION_COOKIE,
  MSP_SSO_RESOLUTION_TTL_SECONDS,
  createSignedMspSsoResolutionCookie,
  getMspSsoSigningSecret,
  isValidResolverCallbackUrl,
  normalizeResolverEmail,
  parseAndVerifyMspSsoDiscoveryCookie,
  parseResolverProvider,
  resolveMspSsoCredentialSource,
} from '@alga-psa/auth/lib/sso/mspSsoResolution';
import {
  buildClearedPendingRememberContextCookie,
  buildPendingRememberContextCookie,
  createPendingRememberContextCookie,
} from '@alga-psa/auth/lib/mspRememberedEmail';

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

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json().catch(() => null)) as
      | { provider?: unknown; email?: unknown; publicWorkstation?: unknown; callbackUrl?: unknown }
      | null;

    const provider = parseResolverProvider(body?.provider);
    const email = typeof body?.email === 'string' ? normalizeResolverEmail(body.email) : '';
    const publicWorkstation = body?.publicWorkstation === true;
    const callbackUrl =
      typeof body?.callbackUrl === 'string' ? body.callbackUrl.trim() : undefined;

    if (
      !provider ||
      !email ||
      !EMAIL_PATTERN.test(email) ||
      !isValidResolverCallbackUrl(callbackUrl)
    ) {
      return buildGenericFailureResponse();
    }

    const ip = getRequestIp(request);
    const emailHashBucket = createHash('sha256').update(email).digest('hex').slice(0, 16);
    const limiterKey = `${ip}:${emailHashBucket}`;

    try {
      await resolverRateLimiter.consume(limiterKey);
    } catch {
      return buildGenericFailureResponse();
    }

    const signingSecret = await getMspSsoSigningSecret();
    if (!signingSecret) {
      console.warn('[msp-sso-resolve] NEXTAUTH_SECRET not configured; unable to issue resolution cookie');
      return buildGenericFailureResponse();
    }

    const discoveryCookieValue = request.cookies.get(MSP_SSO_DISCOVERY_COOKIE)?.value;
    const discoveryContext = parseAndVerifyMspSsoDiscoveryCookie({
      value: discoveryCookieValue,
      secret: signingSecret,
    });

    // Anti-enumeration rule: lookup outcomes only affect internal source selection, never external messaging.
    const outcome = await resolveMspSsoCredentialSource({
      provider,
      email,
      discovery: discoveryContext,
    });
    if (!outcome.resolved || !outcome.source) {
      console.info('[msp-sso-resolve] no available credential source', {
        provider,
        discovery: discoveryContext ? 'present' : 'missing-or-invalid',
      });
      return buildGenericFailureResponse();
    }

    const cookie = createSignedMspSsoResolutionCookie({
      provider,
      source: outcome.source,
      tenantId: outcome.tenantId,
      secret: signingSecret,
      ttlSeconds: MSP_SSO_RESOLUTION_TTL_SECONDS,
    });
    const pendingRememberContext = createPendingRememberContextCookie({
      email,
      publicWorkstation,
      secret: signingSecret,
    });

    const response = NextResponse.json({ ok: true }, { status: 200 });
    response.cookies.set({
      name: MSP_SSO_RESOLUTION_COOKIE,
      value: cookie.value,
      path: '/',
      maxAge: MSP_SSO_RESOLUTION_TTL_SECONDS,
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });
    response.cookies.set(buildPendingRememberContextCookie(pendingRememberContext.value));

    console.info('[msp-sso-resolve] credential source selected', {
      provider,
      source: outcome.source,
    });

    return response;
  } catch (error) {
    console.error('[msp-sso-resolve] unexpected failure', {
      message: error instanceof Error ? error.message : String(error),
    });
    return buildGenericFailureResponse();
  }
}
