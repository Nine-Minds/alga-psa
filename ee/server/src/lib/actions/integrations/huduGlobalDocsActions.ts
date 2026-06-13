'use server';

/**
 * Cross-company Hudu article listing for the Documents page "Hudu" tab
 * (F231, FR14/FR16). One Hudu page (25 items) per invocation — never a page
 * fan-out (NFR2) — with the user's search term passed through to Hudu and
 * each article's company resolved to its Alga client via the companies cache
 * + client mapping rows. Gating mirrors the sibling action wrappers (EE tier
 * + Enterprise add-on + `hudu-integration` flag) but on `client` read RBAC:
 * browsing articles is a Technician flow, not settings administration.
 */

import logger from '@alga-psa/core/logger';
import { withAuth, hasPermission } from '@alga-psa/auth';
import type { IUserWithRoles } from '@alga-psa/types';
import { ADD_ONS, TIER_FEATURES } from '@alga-psa/types';
import { featureFlags } from 'server/src/lib/feature-flags/featureFlags';
import { assertAddOnAccess } from 'server/src/lib/tier-gating/assertAddOnAccess';
import { assertTierAccess } from 'server/src/lib/tier-gating/assertTierAccess';
import { createTenantKnex } from 'server/src/lib/db';
import { createHuduClient, HuduRequestError } from '../../integrations/hudu/huduClient';
import type { HuduErrorKind } from '../../integrations/hudu/huduClient';
import { getHuduIntegration } from '../../integrations/hudu/huduIntegrationRepository';
import { getHuduCompanyMappingRows, parseCompaniesCache } from '../../integrations/hudu/companyMapping';
import { buildHuduRecordUrl } from '../../integrations/hudu/referenceData';

/** Hudu pages are a fixed 25 items; a full page implies more may follow. */
const HUDU_ARTICLES_PAGE_SIZE = 25;

export interface HuduGlobalArticleView {
  id: number;
  name: string;
  updated_at: string | null;
  url: string | null;
  company_id: number | null;
  company_name: string | null;
  client_id: string | null;
  client_name: string | null;
}

export type HuduGlobalArticlesResult =
  | {
      state: 'ok';
      articles: HuduGlobalArticleView[];
      page: number;
      hasMore: boolean;
      fetchedAt: string;
    }
  | { state: 'disconnected' }
  | { state: 'error'; error: string; errorKind?: HuduErrorKind };

export interface ListHuduArticlesAcrossCompaniesInput {
  page?: number;
  search?: string;
}

function withHuduClientReadAccess<TArgs extends unknown[], TResult>(
  handler: (user: IUserWithRoles, context: { tenant: string }, ...args: TArgs) => Promise<TResult>
) {
  return withAuth(async (user, context, ...args: TArgs): Promise<TResult> => {
    if (user.user_type === 'client') {
      throw new Error('Forbidden');
    }

    const allowed = await hasPermission(user, 'client', 'read');
    if (!allowed) {
      throw new Error('Forbidden: insufficient permissions (read)');
    }

    await assertTierAccess(TIER_FEATURES.INTEGRATIONS);
    await assertAddOnAccess(ADD_ONS.ENTERPRISE);

    const enabled = await featureFlags.isEnabled('hudu-integration', {
      userId: user.user_id,
      tenantId: context.tenant,
    });
    if (!enabled) {
      throw new Error('Hudu integration is disabled for this tenant.');
    }

    return handler(user, context as { tenant: string }, ...args);
  });
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * F231: one live Hudu articles page (no company filter) with search
 * passthrough; companies resolve to names via the cached companies list and
 * to Alga clients via the mapping rows — unknown/unmapped companies surface
 * as nulls for the UI's "Unmapped" badge. No connection row ⇒ typed
 * `disconnected` (no Hudu call).
 */
export const listHuduArticlesAcrossCompanies = withHuduClientReadAccess(
  async (
    _user,
    { tenant },
    input?: ListHuduArticlesAcrossCompaniesInput
  ): Promise<HuduGlobalArticlesResult> => {
    const page = typeof input?.page === 'number' && input.page >= 1 ? Math.floor(input.page) : 1;
    const search = input?.search;
    try {
      const { knex } = await createTenantKnex(tenant);

      const row = await getHuduIntegration(knex, tenant);
      if (row?.is_active !== true) {
        return { state: 'disconnected' };
      }

      const client = await createHuduClient(tenant);
      const items = await client.listAllArticles({ page, search });

      const companyNameById = new Map(
        (parseCompaniesCache(row.settings)?.companies ?? []).map((company) => [
          String(company.id),
          company.name,
        ])
      );
      const mappingRows = await getHuduCompanyMappingRows(knex, tenant);
      const clientByCompanyId = new Map(
        mappingRows.map((mapping) => [
          mapping.external_entity_id,
          { client_id: mapping.alga_entity_id, client_name: mapping.client_name },
        ])
      );

      const articles: HuduGlobalArticleView[] = items.map((article) => {
        const companyKey =
          article.company_id === null || article.company_id === undefined
            ? null
            : String(article.company_id);
        const mappedClient = companyKey ? clientByCompanyId.get(companyKey) : undefined;
        return {
          id: article.id,
          name: article.name,
          updated_at: article.updated_at ?? null,
          url: buildHuduRecordUrl(article, row.base_url),
          company_id: article.company_id ?? null,
          company_name: companyKey ? (companyNameById.get(companyKey) ?? null) : null,
          client_id: mappedClient?.client_id ?? null,
          client_name: mappedClient?.client_name ?? null,
        };
      });

      return {
        state: 'ok',
        articles,
        page,
        hasMore: items.length === HUDU_ARTICLES_PAGE_SIZE,
        fetchedAt: new Date().toISOString(),
      };
    } catch (error) {
      logger.error('[HuduGlobalDocsActions] listHuduArticlesAcrossCompanies failed', {
        tenant,
        page,
        error: toErrorMessage(error),
      });
      return {
        state: 'error',
        error: toErrorMessage(error),
        ...(error instanceof HuduRequestError ? { errorKind: error.hudu.kind } : {}),
      };
    }
  }
);
