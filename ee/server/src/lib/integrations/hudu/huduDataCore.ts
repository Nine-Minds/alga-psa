/**
 * Hudu reference-data fetch core (EE-only, session-free).
 *
 * The plain fetch/cache/link logic behind the withAuth getHuduCompany* actions
 * (huduDataActions.ts). Kept session-free so the tenant-wide import/sync core
 * (runHuduTenantSync) can call it from a background job with no user session —
 * the actions add the auth/flag gating, this module does the work.
 */

import logger from '@alga-psa/core/logger';
import { createTenantKnex } from 'server/src/lib/db';
import type { Knex } from 'knex';
import { createHuduClient, HuduRequestError } from './huduClient';
import type { HuduClient, HuduErrorKind } from './huduClient';
import { getHuduIntegration } from './huduIntegrationRepository';
import { parseCompaniesCache, resolveHuduCompanyIdForClient } from './companyMapping';
import {
  buildHuduCompanyUrl,
  buildHuduRecordUrl,
  getCachedHuduList,
  setCachedHuduList,
} from './referenceData';
import type { HuduReferenceResource } from './referenceData';

// Result types live in the runtime-free huduDataTypes module so client
// components can `import type` them without pulling in the server data layer.
import type {
  HuduCompanyDataResult,
  HuduCompanyFetchOptions,
  HuduLinkedItem,
} from './huduDataTypes';
export type { HuduCompanyDataResult, HuduCompanyFetchOptions, HuduLinkedItem } from './huduDataTypes';

export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function toErrorResult(error: unknown): { state: 'error'; error: string; errorKind?: HuduErrorKind } {
  return {
    state: 'error',
    error: toErrorMessage(error),
    ...(error instanceof HuduRequestError ? { errorKind: error.hudu.kind } : {}),
  };
}

export async function resolveCompanyUrl(
  knex: Knex,
  tenant: string,
  huduCompanyId: string
): Promise<{ baseUrl: string | null; companyUrl: string | null }> {
  const row = await getHuduIntegration(knex, tenant);
  const baseUrl = row?.base_url ?? null;
  const company =
    parseCompaniesCache(row?.settings)?.companies.find((c) => String(c.id) === huduCompanyId) ?? null;
  return { baseUrl, companyUrl: buildHuduCompanyUrl(company, baseUrl) };
}

/**
 * Shared list flow: resolve mapping (unmapped ⇒ typed state, NO Hudu call),
 * serve from the per-(tenant,company,resource) cache inside the TTL unless
 * refresh, else live-fetch (paginated, per company), project (passwords are
 * value-stripped before caching), then attach deep-links.
 */
export async function fetchCompanyList<TRaw, TItem extends { url?: string | null }>(
  tenant: string,
  clientId: string,
  resource: HuduReferenceResource,
  refresh: boolean,
  fetcher: (client: HuduClient, companyId: number) => Promise<TRaw[]>,
  project: (raw: TRaw) => TItem
): Promise<HuduCompanyDataResult<TItem>> {
  try {
    const { knex } = await createTenantKnex(tenant);

    const huduCompanyId = await resolveHuduCompanyIdForClient(knex, tenant, clientId);
    if (!huduCompanyId) {
      return { state: 'unmapped' };
    }

    const cached = refresh ? null : getCachedHuduList<TItem>(tenant, huduCompanyId, resource);
    let items: TItem[];
    let fetchedAt: string;
    let fromCache = true;
    if (cached) {
      items = cached.items;
      fetchedAt = cached.fetchedAt;
    } else {
      const client = await createHuduClient(tenant);
      items = (await fetcher(client, Number(huduCompanyId))).map(project);
      fetchedAt = new Date().toISOString();
      setCachedHuduList(tenant, huduCompanyId, resource, items, fetchedAt);
      fromCache = false;
    }

    const { baseUrl, companyUrl } = await resolveCompanyUrl(knex, tenant, huduCompanyId);

    return {
      state: 'ok',
      items: items.map((item) => ({ ...item, hudu_url: buildHuduRecordUrl(item, baseUrl) ?? companyUrl })),
      count: items.length,
      huduCompanyId,
      companyUrl,
      fetchedAt,
      fromCache,
    };
  } catch (error) {
    if (error instanceof HuduRequestError && error.hudu.kind === 'no_password_access') {
      return { state: 'no_password_access' };
    }
    logger.error('[HuduDataCore] fetch failed', { tenant, clientId, resource, error: toErrorMessage(error) });
    return toErrorResult(error);
  }
}

/** Session-free assets fetch for a mapped client (used by import/sync cores). */
export async function fetchHuduCompanyAssets(
  tenant: string,
  clientId: string,
  options?: HuduCompanyFetchOptions
): Promise<HuduCompanyDataResult<import('./contracts').HuduAsset>> {
  return fetchCompanyList(
    tenant,
    clientId,
    'assets',
    options?.refresh === true,
    (client, companyId) => client.getAssets(companyId),
    (asset) => asset
  );
}
