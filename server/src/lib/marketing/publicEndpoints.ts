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
 * Get client IP address from request (proxy-aware). Same header precedence
 * as the public appointment-request route.
 */
export function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  const realIp = req.headers.get('x-real-ip');
  const cfConnectingIp = req.headers.get('cf-connecting-ip');

  if (cfConnectingIp) return cfConnectingIp;
  if (realIp) return realIp;
  if (forwarded) return forwarded.split(',')[0].trim();

  return 'unknown';
}
