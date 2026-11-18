import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminConnection } from '@alga-psa/db/admin';
import { getInternalLookupToken, INTERNAL_LOOKUP_HEADER } from 'server/src/lib/portal-domains/hostSurface';
import { recordPortalDomainSeen } from 'server/src/lib/portal-domains/portalDomainSeen';
import { getPortalDomainByHostname } from 'server/src/models/PortalDomainModel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Which surface (client_portal | msp | both) does a request host serve?
 * Used by the Edge middleware, which cannot query the database. Only ACTIVE custom
 * domains answer; anything else (unknown host, pending/failed/disabled domain)
 * returns `{ surface: null }`, which the middleware treats as the legacy
 * client-portal-only behaviour. Exposes nothing beyond the surface of a hostname
 * the caller already holds.
 */
/** True only for lookups made by our own middleware (carries the internal token). */
async function isInternalLookup(request: Pick<NextRequest, 'headers'>): Promise<boolean> {
  const expected = await getInternalLookupToken();
  const provided = request.headers.get(INTERNAL_LOOKUP_HEADER);
  if (!expected || !provided) {
    return false;
  }
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: NextRequest) {
  const host = request.nextUrl.searchParams.get('host')?.trim().toLowerCase() ?? '';
  if (!host || host.length > 253 || !/^[a-z0-9.-]+(?::\d+)?$/.test(host)) {
    return NextResponse.json({ surface: null }, { status: 400 });
  }

  try {
    const knex = await getAdminConnection();
    const candidates = host.includes(':') ? [host, host.split(':')[0]] : [host];
    for (const candidate of candidates) {
      const record = await getPortalDomainByHostname(knex, candidate);
      if (record && record.status === 'active') {
        // Appliance parity: the middleware asks about a host only because a request arrived
        // with that Host, so its lookup doubles as the last-seen signal ("proxy passes Host
        // through"). Never trust `?host=` from other callers: anyone could otherwise mark a
        // domain as seen and hide the "proxy isn't forwarding Host" warning.
        if (await isInternalLookup(request)) {
          await recordPortalDomainSeen(candidate).catch(() => undefined);
        }
        return NextResponse.json({ surface: record.surface }, { headers: { 'cache-control': 'no-store' } });
      }
    }
    return NextResponse.json({ surface: null }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    console.warn('[portal-domain/surface] lookup failed', error instanceof Error ? error.message : error);
    return NextResponse.json({ surface: null }, { status: 503 });
  }
}
