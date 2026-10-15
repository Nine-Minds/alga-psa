import crypto from 'node:crypto';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { THREECX_PROVIDER } from '../providerState';
import type { ThreecxRouteDeps } from './deps';

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export const unknownTenant = () => jsonResponse(404, { error: 'unknown_tenant' });
export const rateLimited = () => jsonResponse(429, { error: 'rate_limited' });
export const forbidden = () => jsonResponse(403, { error: 'forbidden' });
export const invalidRequest = (message?: string) =>
  jsonResponse(400, message ? { error: 'invalid_request', message } : { error: 'invalid_request' });

function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function extractBearer(request: Request): string | null {
  const header = request.headers.get('authorization') ?? '';
  if (!header.toLowerCase().startsWith('bearer ')) return null;
  const token = header.slice('bearer '.length).trim();
  return token || null;
}

export function resolveThreecxBaseUrl(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_BASE_URL;
  if (configured && configured.trim()) return configured.trim();
  return new URL(request.url).origin;
}

export interface AuthenticatedThreecx {
  tenantId: string;
  row: any;
  baseUrl: string;
}

export type ThreecxAuthResult =
  | { ok: true; ctx: AuthenticatedThreecx }
  | { ok: false; response: Response };

/**
 * Shared request pipeline: unknown slug (404) before any key work, then rate
 * limit (429), then bearer verification against the 3cx row's webhook_secret
 * (403), then tier/edition availability (403), then a refusal unless the row is
 * active (403).
 */
export async function authenticateThreecxRequest(
  request: Request,
  tenantSlug: string,
  deps: ThreecxRouteDeps,
): Promise<ThreecxAuthResult> {
  const tenantId = await deps.resolveTenantSlug(tenantSlug);
  if (!tenantId) {
    return { ok: false, response: unknownTenant() };
  }

  const allowed = await deps.checkRateLimit(tenantId);
  if (!allowed) {
    return { ok: false, response: rateLimited() };
  }

  const { knex } = await createTenantKnex(tenantId);
  const row = await tenantDb(knex, tenantId)
    .table('telephony_providers')
    .where({ provider: THREECX_PROVIDER })
    .first();

  const token = extractBearer(request);
  if (!row?.webhook_secret || !token || !timingSafeEqual(token, row.webhook_secret)) {
    return { ok: false, response: forbidden() };
  }

  const availability = await deps.getProviderAvailability(tenantId);
  if (!availability.enabled) {
    return { ok: false, response: forbidden() };
  }

  if (row.status !== 'active') {
    return { ok: false, response: forbidden() };
  }

  return { ok: true, ctx: { tenantId, row, baseUrl: resolveThreecxBaseUrl(request) } };
}
