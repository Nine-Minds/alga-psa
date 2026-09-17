import { createTenantKnex } from '@alga-psa/db';
import { resolveTenantPhoneCountryCode } from '@alga-psa/telephony';
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
import { authenticateThreecxRequest as authenticate, invalidRequest, jsonResponse } from './authenticate';

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
