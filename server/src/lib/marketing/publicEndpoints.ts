import { NextRequest } from 'next/server';
import type { Knex } from 'knex';
import { getConnection } from '@/lib/db/db';
import { tenantDb } from '@alga-psa/db';
import logger from '@alga-psa/core/logger';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PublicMarketingContext {
  knex: Knex;
  tenantId: string;
}

/**
 * Resolve the tenant for a public (unauthenticated) marketing endpoint.
 *
 * Returns null for any malformed or unknown tenant so callers can answer
 * with a generic 404 and never leak whether a tenant exists. Mirrors the
 * tenant-verification approach used by the public appointment-request route.
 */
export async function resolvePublicMarketingTenant(
  tenantParam: string
): Promise<PublicMarketingContext | null> {
  if (!tenantParam || !UUID_RE.test(tenantParam)) return null;
  try {
    const knex = await getConnection(tenantParam);
    const db = tenantDb(knex, tenantParam);
    const tenant = await db.table('tenants').first('tenant');
    if (!tenant) return null;
    return { knex, tenantId: tenantParam };
  } catch (error) {
    logger.warn('[marketing-public] Failed to resolve tenant', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}

/**
 * Get the client IP for rate-limiting. Only the rightmost x-forwarded-for
 * entry is used: it was appended by the trusted proxy hop in front of this
 * server (Next itself stamps it for direct connections). Earlier entries —
 * and x-real-ip / cf-connecting-ip — are client-controlled, and trusting
 * them would let an attacker mint a fresh rate-limit bucket per request.
 */
export function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const hops = forwarded.split(',').map((part) => part.trim()).filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1];
  }
  return 'unknown';
}
