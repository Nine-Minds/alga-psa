'use server';

/**
 * Hudu reference-data server actions (EE-only): per-mapped-company assets /
 * articles / asset-password lists (F060–F066) and the on-demand password
 * reveal (F067/F068). Gating mirrors huduActions (withHuduSettingsAccess):
 * EE tier + Enterprise add-on, `system_settings` RBAC, `hudu-integration`
 * flag. All actions — including reveal — use the READ gate: PRD flow 4 makes
 * viewing/revealing credentials a Technician flow, and the compensating
 * control for reveal is the mandatory fail-closed audit, not a stricter gate.
 *
 * SECURITY (NFR1): list payloads are value-stripped (allowlist) BEFORE they
 * touch the cache or the wire; reveal is a single live GET whose value is
 * returned transiently — never cached, persisted (DB/Vault), or logged — and
 * every successful reveal writes an audit row first (no audit ⇒ no value).
 * NFR4: every fetch is per-mapped-company and unmapped clients short-circuit
 * before any Hudu call.
 */

import logger from '@alga-psa/core/logger';
import { withAuth, hasPermission } from '@alga-psa/auth';
import type { IUserWithRoles } from '@alga-psa/types';
import { ADD_ONS, TIER_FEATURES } from '@alga-psa/types';
import { featureFlags } from 'server/src/lib/feature-flags/featureFlags';
import { assertAddOnAccess } from 'server/src/lib/tier-gating/assertAddOnAccess';
import { assertTierAccess } from 'server/src/lib/tier-gating/assertTierAccess';
import { createTenantKnex } from 'server/src/lib/db';
import type { Knex } from 'knex';
import { createHuduClient, HuduRequestError } from '../../integrations/hudu/huduClient';
import type { HuduClient, HuduErrorKind } from '../../integrations/hudu/huduClient';
import { getHuduIntegration } from '../../integrations/hudu/huduIntegrationRepository';
import {
  parseCompaniesCache,
  resolveHuduCompanyIdForClient as resolveHuduCompanyIdForClientRow,
} from '../../integrations/hudu/companyMapping';
import {
  buildHuduCompanyUrl,
  buildHuduRecordUrl,
  getCachedHuduList,
  setCachedHuduList,
  toHuduAssetPasswordSummary,
} from '../../integrations/hudu/referenceData';
import type { HuduReferenceResource } from '../../integrations/hudu/referenceData';
import { writeHuduPasswordRevealAudit } from '../../integrations/hudu/revealAudit';
import type {
  HuduArticle,
  HuduAsset,
  HuduAssetPassword,
  HuduAssetPasswordSummary,
} from '../../integrations/hudu/contracts';

export type HuduLinkedItem<T> = T & { hudu_url: string | null };

export type HuduCompanyDataResult<TItem> =
  | {
      state: 'ok';
      items: Array<HuduLinkedItem<TItem>>;
      count: number;
      huduCompanyId: string;
      companyUrl: string | null;
      fetchedAt: string;
      fromCache: boolean;
    }
  | { state: 'unmapped' }
  | { state: 'no_password_access' }
  | { state: 'error'; error: string; errorKind?: HuduErrorKind };

export type HuduRevealPasswordResult =
  | { state: 'ok'; value: string }
  | { state: 'unmapped' }
  | { state: 'not_found' }
  | { state: 'no_password_access' }
  | { state: 'error'; error: string; errorKind?: HuduErrorKind };

export interface HuduCompanyFetchOptions {
  /** Bypass the short-lived server cache and repopulate it. */
  refresh?: boolean;
}

/** F070: light gating probe for the client "Hudu"/"Passwords" tabs. */
export interface HuduClientContext {
  connected: boolean;
  mapped: boolean;
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

function toErrorResult(error: unknown): { state: 'error'; error: string; errorKind?: HuduErrorKind } {
  return {
    state: 'error',
    error: toErrorMessage(error),
    ...(error instanceof HuduRequestError ? { errorKind: error.hudu.kind } : {}),
  };
}

async function resolveCompanyUrl(
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
 * value-stripped here, BEFORE caching), then attach deep-links: the record's
 * own url → the company url → null.
 */
async function fetchCompanyList<TRaw, TItem extends { url?: string | null }>(
  tenant: string,
  clientId: string,
  resource: HuduReferenceResource,
  refresh: boolean,
  fetcher: (client: HuduClient, companyId: number) => Promise<TRaw[]>,
  project: (raw: TRaw) => TItem
): Promise<HuduCompanyDataResult<TItem>> {
  try {
    const { knex } = await createTenantKnex(tenant);

    const huduCompanyId = await resolveHuduCompanyIdForClientRow(knex, tenant, clientId);
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
    logger.error('[HuduDataActions] fetch failed', { tenant, clientId, resource, error: toErrorMessage(error) });
    return toErrorResult(error);
  }
}

/**
 * F070: is Hudu connected for the tenant AND is this client mapped to a Hudu
 * company? One cheap call (no Hudu traffic) for the client-tab visibility
 * gate; any failure resolves to hidden rather than throwing at the UI.
 */
export const getHuduClientContext = withHuduSettingsAccess(
  'read',
  async (_user, { tenant }, clientId: string): Promise<HuduClientContext> => {
    try {
      const { knex } = await createTenantKnex(tenant);
      const row = await getHuduIntegration(knex, tenant);
      if (row?.is_active !== true) {
        return { connected: false, mapped: false };
      }
      const huduCompanyId = await resolveHuduCompanyIdForClientRow(knex, tenant, clientId);
      return { connected: true, mapped: huduCompanyId !== null };
    } catch (error) {
      logger.error('[HuduDataActions] getHuduClientContext failed', {
        tenant,
        clientId,
        error: toErrorMessage(error),
      });
      return { connected: false, mapped: false };
    }
  }
);

/** F060: a mapped client's Hudu assets (paginated, cached, refreshable). */
export const getHuduCompanyAssets = withHuduSettingsAccess(
  'read',
  async (
    _user,
    { tenant },
    clientId: string,
    options?: HuduCompanyFetchOptions
  ): Promise<HuduCompanyDataResult<HuduAsset>> =>
    fetchCompanyList<HuduAsset, HuduAsset>(
      tenant,
      clientId,
      'assets',
      options?.refresh === true,
      (client, companyId) => client.getAssets(companyId),
      (asset) => asset
    )
);

/** F061: a mapped client's Hudu articles. */
export const getHuduCompanyArticles = withHuduSettingsAccess(
  'read',
  async (
    _user,
    { tenant },
    clientId: string,
    options?: HuduCompanyFetchOptions
  ): Promise<HuduCompanyDataResult<HuduArticle>> =>
    fetchCompanyList<HuduArticle, HuduArticle>(
      tenant,
      clientId,
      'articles',
      options?.refresh === true,
      (client, companyId) => client.getArticles(companyId),
      (article) => article
    )
);

/**
 * F062/F064/F066: a mapped client's Hudu asset passwords — metadata only.
 * Every record is allowlist-projected (no `password`/`otp_secret`/unknown
 * fields) before caching/returning; a 403 key is a typed state, not a throw.
 */
export const getHuduCompanyPasswords = withHuduSettingsAccess(
  'read',
  async (
    _user,
    { tenant },
    clientId: string,
    options?: HuduCompanyFetchOptions
  ): Promise<HuduCompanyDataResult<HuduAssetPasswordSummary>> =>
    fetchCompanyList<HuduAssetPassword, HuduAssetPasswordSummary>(
      tenant,
      clientId,
      'asset_passwords',
      options?.refresh === true,
      (client, companyId) => client.getAssetPasswords(companyId),
      toHuduAssetPasswordSummary
    )
);

/**
 * F067/F068: reveal one credential via a single live GET. The record must
 * belong to the client's mapped company (otherwise typed not_found — no
 * cross-company leakage). The audit row is written BEFORE the value is
 * returned and a failed audit aborts the reveal. The value is never cached,
 * persisted, or logged.
 */
export const revealHuduPassword = withHuduSettingsAccess(
  'read',
  async (
    user,
    { tenant },
    clientId: string,
    huduPasswordId: string | number
  ): Promise<HuduRevealPasswordResult> => {
    try {
      const { knex } = await createTenantKnex(tenant);

      const huduCompanyId = await resolveHuduCompanyIdForClientRow(knex, tenant, clientId);
      if (!huduCompanyId) {
        return { state: 'unmapped' };
      }

      const client = await createHuduClient(tenant);
      let record: HuduAssetPassword;
      try {
        record = await client.getAssetPassword(Number(huduPasswordId));
      } catch (error) {
        if (error instanceof HuduRequestError) {
          if (error.hudu.kind === 'no_password_access') return { state: 'no_password_access' };
          if (error.hudu.kind === 'not_found') return { state: 'not_found' };
        }
        throw error;
      }

      if (String(record.company_id) !== String(huduCompanyId)) {
        return { state: 'not_found' };
      }

      await writeHuduPasswordRevealAudit(knex, tenant, {
        userId: user.user_id,
        clientId,
        huduPasswordId,
        huduCompanyId,
      });

      logger.info('[HuduDataActions] password revealed', {
        tenant,
        clientId,
        huduPasswordId: String(huduPasswordId),
        huduCompanyId,
      });

      return { state: 'ok', value: record.password ?? '' };
    } catch (error) {
      logger.error('[HuduDataActions] revealHuduPassword failed', {
        tenant,
        clientId,
        huduPasswordId: String(huduPasswordId),
        error: toErrorMessage(error),
      });
      return toErrorResult(error);
    }
  }
);
