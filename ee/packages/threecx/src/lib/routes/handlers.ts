import crypto from 'node:crypto';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { resolveTenantPhoneCountryCode } from '@alga-psa/telephony';
import { THREECX_PROVIDER } from '../providerState';
import { THREECX_QUERY_PARAMS } from '../routeConstants';
import {
  threecxLookupByEmail,
  threecxLookupByNumber,
  threecxSearchContacts,
} from '../lookup';
import {
  buildThreecxCanonicalCall,
  validateThreecxReportCallBody,
} from '../reportCall';
import type { ThreecxRouteDeps } from './deps';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const unknownTenant = () => jsonResponse(404, { error: 'unknown_tenant' });
const rateLimited = () => jsonResponse(429, { error: 'rate_limited' });
const forbidden = () => jsonResponse(403, { error: 'forbidden' });
const invalidRequest = () => jsonResponse(400, { error: 'invalid_request' });

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

function resolveBaseUrl(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_BASE_URL;
  if (configured && configured.trim()) return configured.trim();
  return new URL(request.url).origin;
}

interface AuthenticatedThreecx {
  tenantId: string;
  row: any;
  baseUrl: string;
}

/**
 * Shared request pipeline: unknown slug (404) before any key work, then rate
 * limit (429), then bearer verification against the 3cx row's webhook_secret
 * (403), then tier/edition availability (403), then a refusal unless the row is
 * active (403).
 */
async function authenticate(
  request: Request,
  tenantSlug: string,
  deps: ThreecxRouteDeps,
): Promise<{ ok: true; ctx: AuthenticatedThreecx } | { ok: false; response: Response }> {
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

  return { ok: true, ctx: { tenantId, row, baseUrl: resolveBaseUrl(request), } };
}

export async function handleThreecxLookup(
  request: Request,
  tenantSlug: string,
  deps: ThreecxRouteDeps,
): Promise<Response> {
  const auth = await authenticate(request, tenantSlug, deps);
  if (!auth.ok) return auth.response;

  const number = new URL(request.url).searchParams.get(THREECX_QUERY_PARAMS.number);
  if (!number || !number.trim()) {
    return invalidRequest();
  }

  const contacts = await threecxLookupByNumber(
    { tenantId: auth.ctx.tenantId, baseUrl: auth.ctx.baseUrl },
    number,
  );
  return jsonResponse(200, { contacts });
}

export async function handleThreecxLookupByEmail(
  request: Request,
  tenantSlug: string,
  deps: ThreecxRouteDeps,
): Promise<Response> {
  const auth = await authenticate(request, tenantSlug, deps);
  if (!auth.ok) return auth.response;

  const email = new URL(request.url).searchParams.get(THREECX_QUERY_PARAMS.email);
  if (!email || !email.trim()) {
    return invalidRequest();
  }

  const contacts = await threecxLookupByEmail(
    { tenantId: auth.ctx.tenantId, baseUrl: auth.ctx.baseUrl },
    email,
  );
  return jsonResponse(200, { contacts });
}

export async function handleThreecxSearch(
  request: Request,
  tenantSlug: string,
  deps: ThreecxRouteDeps,
): Promise<Response> {
  const auth = await authenticate(request, tenantSlug, deps);
  if (!auth.ok) return auth.response;

  const q = new URL(request.url).searchParams.get(THREECX_QUERY_PARAMS.q);
  if (!q || !q.trim()) {
    return invalidRequest();
  }

  const contacts = await threecxSearchContacts(
    { tenantId: auth.ctx.tenantId, baseUrl: auth.ctx.baseUrl },
    q,
  );
  return jsonResponse(200, { contacts });
}

export async function handleThreecxReportCall(
  request: Request,
  tenantSlug: string,
  deps: ThreecxRouteDeps,
): Promise<Response> {
  const auth = await authenticate(request, tenantSlug, deps);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const validation = validateThreecxReportCallBody(body);
  if (!validation.ok) {
    return invalidRequest();
  }

  const { knex } = await createTenantKnex(auth.ctx.tenantId);
  const defaultCountryCode = await resolveTenantPhoneCountryCode(knex, auth.ctx.tenantId);
  const record = await buildThreecxCanonicalCall(
    { tenantId: auth.ctx.tenantId, knex, defaultCountryCode },
    validation.value,
  );

  await deps.enqueueCanonicalCall({ tenantId: auth.ctx.tenantId, record });

  return jsonResponse(202, { accepted: true, providerCallId: record.providerCallId });
}
