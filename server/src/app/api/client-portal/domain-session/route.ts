import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { promises as dns } from 'node:dns';
import logger from '@alga-psa/core/logger';
import { getAdminConnection } from '@alga-psa/db/admin';

import { analytics } from 'server/src/lib/analytics/posthog';
import { buildSessionCookie, encodePortalSessionToken } from 'server/src/lib/auth/sessionCookies';
import { consumePortalDomainOtt } from 'server/src/lib/models/PortalDomainSessionToken';
import { getPortalDomainByHostname, normalizeHostname } from 'server/src/models/PortalDomainModel';

function sanitizeReturnPath(returnPath: unknown, fallback: string): string {
  if (typeof returnPath !== 'string' || returnPath.length === 0) {
    return fallback;
  }

  if (!returnPath.startsWith('/')) {
    return fallback;
  }

  return returnPath;
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

    const enforceCname = shouldVerifyCname();

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

    const userSnapshot = ottRecord.metadata.userSnapshot;
    const sessionToken = await encodePortalSessionToken(userSnapshot);
    const sessionCookie = buildSessionCookie(sessionToken);
    const forwardedProto = request.headers.get('x-forwarded-proto');
    const requestUrl = new URL(request.url);
    const requestScheme = forwardedProto?.split(',')[0]?.trim().toLowerCase() ?? requestUrl.protocol.replace(/:$/, '');
    const redirectTo = sanitizeReturnPath(
      requestedReturnPath ?? ottRecord.metadata.returnPath,
      '/client-portal/dashboard',
    );

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
