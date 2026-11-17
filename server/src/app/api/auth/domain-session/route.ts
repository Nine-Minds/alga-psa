import { NextResponse } from 'next/server';
import { cookies } from 'next/headers.js';
import { promises as dns } from 'node:dns';
import logger from '@alga-psa/core/logger';
import { getAdminConnection } from '@alga-psa/db/admin';
import { UserSession } from '@alga-psa/db/models/UserSession';
import {
  HANDOFF_DEFAULT_RETURN_PATH,
  normalizeHandoffReturnPath,
  portalDomainServes,
  surfaceForPath,
  surfaceForUserType,
  type AppSurface,
} from '@alga-psa/shared/core/portalDomainSurface';

import { analytics } from 'server/src/lib/analytics/posthog';
import {
  buildSessionCookie,
  consumePortalDomainOtt,
  encodePortalSessionToken,
  generateDeviceFingerprint,
  getClientIp,
  getDeviceInfo,
  loadSessionUser,
  mintSessionToken,
  type PortalSessionTokenPayload,
} from '@alga-psa/auth';
import { getPortalDomainByHostname, normalizeHostname } from 'server/src/models/PortalDomainModel';
import { resolveRequestProto } from '@/lib/deployment/requestHost';

/**
 * Picks where to send the user. The path must be a relative path inside the OTT's surface
 * (no open redirect); a path that is invalid is replaced by the path recorded on the OTT
 * and then by the surface's default landing page.
 */
function resolveReturnPath(candidates: unknown[], surface: AppSurface): string {
  for (const candidate of candidates) {
    const normalized = normalizeHandoffReturnPath(candidate, surface);
    if (normalized) {
      return normalized;
    }
  }
  return HANDOFF_DEFAULT_RETURN_PATH[surface];
}

interface HostParts {
  hostname: string;
  port?: string | null;
}

function extractHost(hostHeader: string | null): HostParts | null {
  if (!hostHeader) {
    return null;
  }

  const [hostname, port] = hostHeader.split(':');
  if (!hostname) {
    return null;
  }

  return {
    hostname: hostname.toLowerCase(),
    port: port ?? null,
  };
}

async function verifyCnameTarget(host: string, expected: string): Promise<{
  matched: boolean;
  observed: string[];
}> {
  try {
    const observed = await dns.resolveCname(host);
    const normalizedExpected = expected.toLowerCase();
    const matched = observed.some((candidate) => {
      const normalizedCandidate = candidate.toLowerCase();
      return (
        normalizedCandidate === normalizedExpected ||
        normalizedCandidate.endsWith(`.${normalizedExpected}`)
      );
    });

    return { matched, observed };
  } catch (error) {
    logger.warn('Failed to resolve CNAME during domain session exchange', {
      host,
      expected,
      error,
    });
    return { matched: false, observed: [] };
  }
}

function shouldVerifyCname(): boolean {
  const preference = process.env.PORTAL_DOMAIN_DNS_CHECK?.toLowerCase();

  if (preference === 'true') {
    return true;
  }

  if (preference === 'false') {
    return false;
  }

  const environment = process.env.NODE_ENV ?? 'development';
  return environment === 'production';
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json().catch(() => null);
    const ott = body?.ott;
    const requestedReturnPath = body?.returnPath;

    if (typeof ott !== 'string' || ott.length === 0) {
      return NextResponse.json({ error: 'ott_required' }, { status: 400 });
    }

    const hostHeader = request.headers.get('host');
    const hostParts = extractHost(hostHeader);

    if (!hostParts) {
      return NextResponse.json({ error: 'host_missing' }, { status: 400 });
    }

    const knex = await getAdminConnection();
    const hostCandidates = [hostParts.hostname];
    if (hostParts.port && hostParts.port !== '80' && hostParts.port !== '443') {
      hostCandidates.unshift(`${hostParts.hostname}:${hostParts.port}`);
    }

    const portalDomain = await (async () => {
      for (const candidate of hostCandidates) {
        const match = await getPortalDomainByHostname(knex, candidate);
        if (match) {
          return match;
        }
      }
      return null;
    })();

    if (!portalDomain) {
      logger.warn('OTT exchange attempted on unknown host', { host: hostHeader });
      await analytics.capture('portal_domain.ott_failed', {
        reason: 'domain_not_found',
        host: hostHeader ?? undefined,
      });
      return NextResponse.json({ error: 'domain_not_found' }, { status: 404 });
    }

    if (portalDomain.status !== 'active') {
      logger.warn('OTT exchange attempted for inactive domain', {
        host: hostHeader,
        tenant: portalDomain.tenant,
        status: portalDomain.status,
      });
      await analytics.capture('portal_domain.ott_failed', {
        reason: 'domain_inactive',
        tenant: portalDomain.tenant,
        portal_domain_id: portalDomain.id,
        host: hostHeader,
      });
      return NextResponse.json({
        error: 'domain_inactive',
        canonicalHost: portalDomain.canonicalHost,
      }, { status: 403 });
    }

    const normalizedHost = normalizeHostname(hostParts.hostname);
    const normalizedPortalDomain = normalizeHostname(portalDomain.domain.split(':')[0] ?? portalDomain.domain);

    if (normalizedPortalDomain !== normalizedHost) {
      logger.warn('Host mismatch during OTT exchange', {
        host: hostHeader,
        tenant: portalDomain.tenant,
        domain: portalDomain.domain,
      });
      await analytics.capture('portal_domain.ott_failed', {
        reason: 'host_mismatch',
        tenant: portalDomain.tenant,
        portal_domain_id: portalDomain.id,
        host: hostHeader,
        domain: portalDomain.domain,
      });
      return NextResponse.json({
        error: 'domain_mismatch',
        canonicalHost: portalDomain.canonicalHost,
      }, { status: 403 });
    }

    const expectedCname = (() => {
      const details = portalDomain.verificationDetails ?? {};
      const candidate = (details as Record<string, unknown>).expected_cname;
      return typeof candidate === 'string' ? candidate : null;
    })();

    // Active domains were already CNAME-verified during registration and are kept
    // live by ongoing cert-manager renewal, so we trust that state rather than
    // re-resolving DNS on every login. Re-checking here breaks legitimate setups
    // that front the custom domain with a proxy (e.g. Cloudflare "orange cloud"),
    // which hides the CNAME from resolution even though traffic and TLS are healthy.
    const isActiveDomain = portalDomain.status === 'active';
    const enforceCname = shouldVerifyCname() && !isActiveDomain;

    const cnameHost = hostParts.hostname;

    if (expectedCname && enforceCname) {
      const { matched, observed } = await verifyCnameTarget(cnameHost, expectedCname);
      if (!matched) {
        logger.warn('CNAME mismatch detected during OTT exchange', {
          host: cnameHost,
          expected: expectedCname,
          observed,
          tenant: portalDomain.tenant,
        });
        await analytics.capture('portal_domain.ott_failed', {
          reason: 'dns_mismatch',
          tenant: portalDomain.tenant,
          portal_domain_id: portalDomain.id,
          host: cnameHost,
          expected_cname: expectedCname,
          observed,
        });
        return NextResponse.json({
          error: 'dns_mismatch',
          canonicalHost: portalDomain.canonicalHost,
        }, { status: 409 });
      }
    } else if (expectedCname) {
      logger.debug('Skipping CNAME verification for portal domain exchange', {
        host: cnameHost,
        tenant: portalDomain.tenant,
        expected: expectedCname,
        enforceCname,
        domainStatus: portalDomain.status,
      });
    }

    const ottRecord = await consumePortalDomainOtt({
      tenant: portalDomain.tenant,
      portalDomainId: portalDomain.id,
      token: ott,
    });

    if (!ottRecord) {
      return NextResponse.json({
        error: 'invalid_or_expired',
        canonicalHost: portalDomain.canonicalHost,
      }, { status: 400 });
    }

    const surface = ottRecord.metadata.surface;

    // The OTT row is tenant-scoped, so a token issued for another tenant's domain is never
    // found above; this keeps the rule explicit and independent of that storage detail.
    if (ottRecord.tenant !== portalDomain.tenant) {
      logger.warn('OTT tenant does not own the requesting domain', {
        host: hostHeader,
        domainTenant: portalDomain.tenant,
      });
      return NextResponse.json({ error: 'tenant_mismatch', canonicalHost: portalDomain.canonicalHost }, { status: 403 });
    }

    // The domain must serve the app the token was issued for, and a requested return path
    // must not name an app the domain does not serve.
    const requestedSurface = typeof requestedReturnPath === 'string' ? surfaceForPath(requestedReturnPath.split(/[?#]/)[0]) : null;
    if (
      !portalDomainServes(portalDomain.surface, surface)
      || (requestedSurface && !portalDomainServes(portalDomain.surface, requestedSurface))
    ) {
      logger.warn('OTT exchange refused: domain does not serve the requested surface', {
        host: hostHeader,
        tenant: portalDomain.tenant,
        surface,
        domainSurface: portalDomain.surface,
      });
      await analytics.capture('portal_domain.ott_failed', {
        reason: 'surface_not_served',
        tenant: portalDomain.tenant,
        portal_domain_id: portalDomain.id,
        host: hostHeader,
      });
      return NextResponse.json({ error: 'surface_not_served', canonicalHost: portalDomain.canonicalHost }, { status: 403 });
    }

    const user = await loadSessionUser(portalDomain.tenant, ottRecord.userId);
    if (!user || surfaceForUserType(user.user_type) !== surface) {
      logger.warn('OTT exchange refused: user missing, inactive or not of the token surface', {
        tenant: portalDomain.tenant,
        surface,
      });
      return NextResponse.json({ error: 'invalid_or_expired', canonicalHost: portalDomain.canonicalHost }, { status: 400 });
    }

    const ip = getClientIp(request);
    const userAgent = request.headers.get('user-agent') ?? 'unknown';
    const deviceInfo = getDeviceInfo(userAgent);

    await UserSession.enforceMaxSessions(portalDomain.tenant, user.id, 5);
    // The same function the NextAuth jwt callback mints a direct sign-in with.
    const token = await mintSessionToken({
      token: {},
      user: {
        ...user,
        deviceInfo: {
          ip,
          userAgent,
          deviceFingerprint: generateDeviceFingerprint(userAgent),
          deviceName: deviceInfo.name,
          deviceType: deviceInfo.type,
          locationData: null,
        },
      },
      loginMethod: ottRecord.metadata.loginMethod ?? 'credentials',
    });
    if (typeof token.session_id !== 'string' || token.session_id.length === 0) {
      logger.error('Failed to mint a tracked session for the portal domain exchange', {
        tenant: portalDomain.tenant,
      });
      return NextResponse.json({ error: 'exchange_failed' }, { status: 500 });
    }

    const sessionToken = await encodePortalSessionToken(token as PortalSessionTokenPayload);
    const sessionCookie = buildSessionCookie(sessionToken);
    const requestUrl = new URL(request.url);
    const requestScheme = resolveRequestProto(request) ?? requestUrl.protocol.replace(/:$/, '');
    const redirectTo = resolveReturnPath([requestedReturnPath, ottRecord.metadata.returnPath], surface);

    const cookieOptions = {
      ...sessionCookie.options,
      secure: requestScheme === 'https' ? sessionCookie.options?.secure ?? true : false,
    };

    const response = NextResponse.json({ redirectTo, canonicalHost: portalDomain.canonicalHost }, { status: 200 });
    response.cookies.set({
      name: sessionCookie.name,
      value: sessionCookie.value,
      maxAge: sessionCookie.maxAge,
      ...cookieOptions,
    });

    return response;
  } catch (error) {
    logger.error('Failed to process portal domain session exchange', error);
    return NextResponse.json({ error: 'exchange_failed' }, { status: 500 });
  }
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204 });
}
