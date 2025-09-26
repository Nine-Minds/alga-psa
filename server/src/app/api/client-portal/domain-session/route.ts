import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { promises as dns } from 'node:dns';
import logger from '@alga-psa/shared/core/logger';
import { getAdminConnection } from '@shared/db/admin';

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

function extractHost(hostHeader: string | null): string | null {
  if (!hostHeader) {
    return null;
  }

  const [host] = hostHeader.split(':');
  return host ? host.toLowerCase() : null;
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

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json().catch(() => null);
    const ott = body?.ott;
    const requestedReturnPath = body?.returnPath;

    if (typeof ott !== 'string' || ott.length === 0) {
      return NextResponse.json({ error: 'ott_required' }, { status: 400 });
    }

    const hostHeader = request.headers.get('host');
    const host = extractHost(hostHeader);

    if (!host) {
      return NextResponse.json({ error: 'host_missing' }, { status: 400 });
    }

    const knex = await getAdminConnection();
    const portalDomain = await getPortalDomainByHostname(knex, host);

    if (!portalDomain) {
      logger.warn('OTT exchange attempted on unknown host', { host });
      await analytics.capture('portal_domain.ott_failed', {
        reason: 'domain_not_found',
        host,
      });
      return NextResponse.json({ error: 'domain_not_found' }, { status: 404 });
    }

    if (portalDomain.status !== 'active') {
      logger.warn('OTT exchange attempted for inactive domain', {
        host,
        tenant: portalDomain.tenant,
        status: portalDomain.status,
      });
      await analytics.capture('portal_domain.ott_failed', {
        reason: 'domain_inactive',
        tenant: portalDomain.tenant,
        portal_domain_id: portalDomain.id,
        host,
      });
      return NextResponse.json({
        error: 'domain_inactive',
        canonicalHost: portalDomain.canonicalHost,
      }, { status: 403 });
    }

    const normalizedHost = normalizeHostname(host);
    if (portalDomain.domain !== normalizedHost) {
      logger.warn('Host mismatch during OTT exchange', {
        host,
        tenant: portalDomain.tenant,
        domain: portalDomain.domain,
      });
      await analytics.capture('portal_domain.ott_failed', {
        reason: 'host_mismatch',
        tenant: portalDomain.tenant,
        portal_domain_id: portalDomain.id,
        host,
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

    if (expectedCname) {
      const { matched, observed } = await verifyCnameTarget(host, expectedCname);
      if (!matched) {
        logger.warn('CNAME mismatch detected during OTT exchange', {
          host,
          expected: expectedCname,
          observed,
          tenant: portalDomain.tenant,
        });
        await analytics.capture('portal_domain.ott_failed', {
          reason: 'dns_mismatch',
          tenant: portalDomain.tenant,
          portal_domain_id: portalDomain.id,
          host,
          expected_cname: expectedCname,
          observed,
        });
        return NextResponse.json({
          error: 'dns_mismatch',
          canonicalHost: portalDomain.canonicalHost,
        }, { status: 409 });
      }
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

    cookies().set({
      name: sessionCookie.name,
      value: sessionCookie.value,
      maxAge: sessionCookie.maxAge,
      ...sessionCookie.options,
    });

    const redirectTo = sanitizeReturnPath(
      requestedReturnPath ?? ottRecord.metadata.returnPath,
      '/client-portal/dashboard',
    );

    return NextResponse.json({ redirectTo, canonicalHost: portalDomain.canonicalHost }, { status: 200 });
  } catch (error) {
    logger.error('Failed to process portal domain session exchange', error);
    return NextResponse.json({ error: 'exchange_failed' }, { status: 500 });
  }
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204 });
}
