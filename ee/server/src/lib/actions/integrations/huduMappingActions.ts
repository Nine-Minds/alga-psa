'use server';

/**
 * Hudu company↔client mapping server actions (EE-only).
 *
 * sync / list / set / clear for company mappings in the SHARED CE table
 * `tenant_external_entity_mappings`. Gating mirrors huduActions
 * (withHuduSettingsAccess): EE tier, `system_settings`
 * RBAC (read=list, update=mutate) — NOT the billing_settings-gated
 * externalMappingActions wrappers (OQ3).
 *
 * "Cache the list for mapping" (F040) = a compact companies snapshot in
 * hudu_integrations.settings.companies_cache so the mapping UI renders
 * without refetching. Metadata only — never an entity import, never secrets.
 */

import logger from '@alga-psa/core/logger';
import { withAuth, hasPermission } from '@alga-psa/auth';
import type { IUserWithRoles } from '@alga-psa/types';
import { TIER_FEATURES } from '@alga-psa/types';
import { assertTierAccess } from 'server/src/lib/tier-gating/assertTierAccess';
import { createTenantKnex } from 'server/src/lib/db';
import type { Knex } from 'knex';
import { createHuduClient } from '../../integrations/hudu/huduClient';
import {
  getHuduIntegration,
  upsertHuduIntegration,
} from '../../integrations/hudu/huduIntegrationRepository';
import {
  HUDU_COMPANIES_CACHE_KEY,
  buildCompaniesCache,
  parseCompaniesCache,
  suggestHuduCompanyMappings,
  setHuduCompanyMappingRow,
  clearHuduCompanyMappingRow,
  getHuduCompanyMappingRows,
  resolveHuduCompanyIdForClient as resolveHuduCompanyIdForClientRow,
  resolveClientIdForHuduCompany as resolveClientIdForHuduCompanyRow,
} from '../../integrations/hudu/companyMapping';
import type {
  HuduCompaniesCache,
  HuduMappingErrorCode,
  HuduMappingMetadata,
  HuduMappingSuggestion,
  HuduMappingWriteResult,
  HuduMatcherClient,
} from '../../integrations/hudu/companyMapping';

export type HuduMappingActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: HuduMappingErrorCode };

export interface HuduCompanyMappingView {
  hudu_company_id: number;
  hudu_company_name: string;
  id_in_integration: string | null;
  url: string | null;
  mapping: { mapping_id: string; client_id: string; client_name: string | null } | null;
  suggestion: HuduMappingSuggestion | null;
}

export interface HuduCompanyMappingsData {
  companies: HuduCompanyMappingView[];
  fetched_at: string;
  fromCache: boolean;
}

export interface SetHuduCompanyMappingActionInput {
  clientId: string;
  huduCompanyId: string | number;
  metadata?: HuduMappingMetadata;
}

export interface ClearHuduCompanyMappingActionInput {
  mappingId?: string;
  huduCompanyId?: string | number;
}

type HuduActionPermission = 'read' | 'update';

function withHuduSettingsAccess<TArgs extends unknown[], TResult>(
  requiredPermission: HuduActionPermission,
  handler: (user: IUserWithRoles, context: { tenant: string }, ...args: TArgs) => Promise<TResult>
) {
  return withAuth(async (user, context, ...args: TArgs): Promise<TResult> => {
    if (user.user_type === 'client') {
      throw new Error('Forbidden');
    }

    const allowed = await hasPermission(user, 'system_settings', requiredPermission);
    if (!allowed) {
      throw new Error(`Forbidden: insufficient permissions (${requiredPermission})`);
    }

    await assertTierAccess(TIER_FEATURES.INTEGRATIONS);

    return handler(user, context as { tenant: string }, ...args);
  });
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function fetchAndCacheCompanies(knex: Knex, tenant: string): Promise<HuduCompaniesCache> {
  const client = await createHuduClient(tenant);
  const companies = await client.getCompanies();
  const cache = buildCompaniesCache(companies);

  const row = await getHuduIntegration(knex, tenant);
  await upsertHuduIntegration(knex, tenant, {
    settings: { ...(row?.settings ?? {}), [HUDU_COMPANIES_CACHE_KEY]: cache },
  });

  return cache;
}

async function listMatchableClients(knex: Knex, tenant: string): Promise<HuduMatcherClient[]> {
  return knex('clients')
    .where({ tenant })
    .where((qb) => qb.where('is_inactive', false).orWhereNull('is_inactive'))
    .select('client_id', 'client_name');
}

/**
 * F040: fetch ALL Hudu companies (the client aggregates every page) and store
 * the compact snapshot in hudu_integrations.settings.companies_cache.
 */
export const syncHuduCompanies = withHuduSettingsAccess(
  'update',
  async (_user, { tenant }): Promise<HuduMappingActionResult<HuduCompaniesCache>> => {
    try {
      const { knex } = await createTenantKnex(tenant);
      const cache = await fetchAndCacheCompanies(knex, tenant);

      logger.info('[HuduMappingActions] companies synced', { tenant, count: cache.companies.length });

      return { success: true, data: cache };
    } catch (error) {
      logger.error('[HuduMappingActions] syncHuduCompanies failed', { tenant, error: toErrorMessage(error) });
      return { success: false, error: toErrorMessage(error) };
    }
  }
);

/**
 * F044: company list (cached when available, live-fetched otherwise) joined
 * with current mappings (+ mapped client name) and a computed suggestion for
 * each unmapped company.
 */
export const getHuduCompanyMappings = withHuduSettingsAccess(
  'read',
  async (_user, { tenant }): Promise<HuduMappingActionResult<HuduCompanyMappingsData>> => {
    try {
      const { knex } = await createTenantKnex(tenant);

      const row = await getHuduIntegration(knex, tenant);
      let cache = parseCompaniesCache(row?.settings);
      let fromCache = true;
      if (!cache) {
        // Read-gated path: fetch in memory, don't write settings here.
        const client = await createHuduClient(tenant);
        cache = buildCompaniesCache(await client.getCompanies());
        fromCache = false;
      }

      const mappingRows = await getHuduCompanyMappingRows(knex, tenant);
      const mappingByCompanyId = new Map(mappingRows.map((m) => [m.external_entity_id, m]));

      const clients = await listMatchableClients(knex, tenant);
      const suggestions = suggestHuduCompanyMappings(
        cache.companies,
        clients,
        mappingRows.map((m) => ({ client_id: m.alga_entity_id, hudu_company_id: m.external_entity_id }))
      );

      const companies: HuduCompanyMappingView[] = cache.companies.map((company) => {
        const mapping = mappingByCompanyId.get(String(company.id));
        return {
          hudu_company_id: company.id,
          hudu_company_name: company.name,
          id_in_integration: company.id_in_integration,
          url: company.url,
          mapping: mapping
            ? { mapping_id: mapping.id, client_id: mapping.alga_entity_id, client_name: mapping.client_name }
            : null,
          suggestion: suggestions.get(company.id) ?? null,
        };
      });

      return { success: true, data: { companies, fetched_at: cache.fetched_at, fromCache } };
    } catch (error) {
      logger.error('[HuduMappingActions] getHuduCompanyMappings failed', { tenant, error: toErrorMessage(error) });
      return { success: false, error: toErrorMessage(error) };
    }
  }
);

/**
 * F045/F043: map one client to one Hudu company. Rejects with a typed code
 * when either side is already mapped — replace is explicit clear+set.
 * Metadata gaps are enriched from the companies cache when possible.
 */
export const setHuduCompanyMapping = withHuduSettingsAccess(
  'update',
  async (
    _user,
    { tenant },
    input: SetHuduCompanyMappingActionInput
  ): Promise<HuduMappingActionResult<{ mapping_id: string }>> => {
    try {
      if (!input?.clientId || input?.huduCompanyId === undefined || input?.huduCompanyId === null) {
        return { success: false, error: 'clientId and huduCompanyId are required.' };
      }

      const { knex } = await createTenantKnex(tenant);

      let metadata = input.metadata;
      if (!metadata?.hudu_company_name) {
        const row = await getHuduIntegration(knex, tenant);
        const cached = parseCompaniesCache(row?.settings)?.companies.find(
          (c) => String(c.id) === String(input.huduCompanyId)
        );
        if (cached) {
          metadata = {
            hudu_company_name: metadata?.hudu_company_name ?? cached.name,
            id_in_integration: metadata?.id_in_integration ?? cached.id_in_integration,
            url: metadata?.url ?? cached.url,
          };
        }
      }

      const result = await setHuduCompanyMappingRow(knex, tenant, {
        clientId: input.clientId,
        huduCompanyId: input.huduCompanyId,
        metadata,
      });

      if (!result.ok) {
        const failure = result as Extract<HuduMappingWriteResult, { ok: false }>;
        return { success: false, error: failure.message, code: failure.code };
      }

      logger.info('[HuduMappingActions] mapping set', {
        tenant,
        clientId: input.clientId,
        huduCompanyId: String(input.huduCompanyId),
      });

      return { success: true, data: { mapping_id: result.mapping.id } };
    } catch (error) {
      logger.error('[HuduMappingActions] setHuduCompanyMapping failed', { tenant, error: toErrorMessage(error) });
      return { success: false, error: toErrorMessage(error) };
    }
  }
);

/** F045: clear a mapping by mapping id or Hudu company id. */
export const clearHuduCompanyMapping = withHuduSettingsAccess(
  'update',
  async (
    _user,
    { tenant },
    input: ClearHuduCompanyMappingActionInput
  ): Promise<HuduMappingActionResult<{ cleared: number }>> => {
    try {
      if (!input?.mappingId && (input?.huduCompanyId === undefined || input?.huduCompanyId === null)) {
        return { success: false, error: 'mappingId or huduCompanyId is required.' };
      }

      const { knex } = await createTenantKnex(tenant);
      const cleared = await clearHuduCompanyMappingRow(knex, tenant, input);

      if (cleared === 0) {
        return { success: false, error: 'Mapping not found.', code: 'not_found' };
      }

      logger.info('[HuduMappingActions] mapping cleared', { tenant, cleared });

      return { success: true, data: { cleared } };
    } catch (error) {
      logger.error('[HuduMappingActions] clearHuduCompanyMapping failed', { tenant, error: toErrorMessage(error) });
      return { success: false, error: toErrorMessage(error) };
    }
  }
);

/** F046: resolver actions for downstream data-fetch groups (read-gated). */
export const resolveHuduCompanyIdForClient = withHuduSettingsAccess(
  'read',
  async (_user, { tenant }, clientId: string): Promise<HuduMappingActionResult<{ huduCompanyId: string | null }>> => {
    try {
      const { knex } = await createTenantKnex(tenant);
      const huduCompanyId = await resolveHuduCompanyIdForClientRow(knex, tenant, clientId);
      return { success: true, data: { huduCompanyId } };
    } catch (error) {
      logger.error('[HuduMappingActions] resolveHuduCompanyIdForClient failed', { tenant, error: toErrorMessage(error) });
      return { success: false, error: toErrorMessage(error) };
    }
  }
);

export const resolveClientIdForHuduCompany = withHuduSettingsAccess(
  'read',
  async (
    _user,
    { tenant },
    huduCompanyId: string | number
  ): Promise<HuduMappingActionResult<{ clientId: string | null }>> => {
    try {
      const { knex } = await createTenantKnex(tenant);
      const clientId = await resolveClientIdForHuduCompanyRow(knex, tenant, huduCompanyId);
      return { success: true, data: { clientId } };
    } catch (error) {
      logger.error('[HuduMappingActions] resolveClientIdForHuduCompany failed', { tenant, error: toErrorMessage(error) });
      return { success: false, error: toErrorMessage(error) };
    }
  }
);
