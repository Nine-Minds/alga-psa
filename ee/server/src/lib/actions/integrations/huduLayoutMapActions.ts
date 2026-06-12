'use server';

/**
 * Hudu asset-layout→asset-type map server actions (EE-only, Phase 2 FR11).
 *
 * get/set for `hudu_integrations.settings.asset_layout_type_map`. Gating
 * mirrors huduActions (withHuduSettingsAccess): EE tier + Enterprise add-on,
 * `system_settings` RBAC (read=view, update=persist), and the
 * `hudu-integration` flag — enforced on every action.
 */

import logger from '@alga-psa/core/logger';
import { withAuth, hasPermission } from '@alga-psa/auth';
import type { IUserWithRoles } from '@alga-psa/types';
import { ADD_ONS, TIER_FEATURES } from '@alga-psa/types';
import { featureFlags } from 'server/src/lib/feature-flags/featureFlags';
import { assertAddOnAccess } from 'server/src/lib/tier-gating/assertAddOnAccess';
import { assertTierAccess } from 'server/src/lib/tier-gating/assertTierAccess';
import { createTenantKnex } from 'server/src/lib/db';
import { createHuduClient } from '../../integrations/hudu/huduClient';
import {
  getHuduAssetLayoutTypeMap,
  setHuduAssetLayoutTypeMap,
  suggestAssetTypeForLayout,
} from '../../integrations/hudu/assetLayoutMap';
import type { AlgaAssetType, HuduAssetLayoutTypeMap } from '../../integrations/hudu/assetLayoutMap';

export type HuduLayoutMapActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export interface HuduAssetLayoutMapEntry {
  id: number;
  name: string;
  suggestedType: AlgaAssetType;
  configuredType: AlgaAssetType | null;
}

export interface HuduAssetLayoutMapData {
  layouts: HuduAssetLayoutMapEntry[];
  map: HuduAssetLayoutTypeMap;
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

/**
 * F205: live asset layouts joined with the stored map; each layout carries a
 * heuristic suggestion (FR12) and the configured type when one is stored.
 */
export const getHuduAssetLayoutMap = withHuduSettingsAccess(
  'read',
  async (_user, { tenant }): Promise<HuduLayoutMapActionResult<HuduAssetLayoutMapData>> => {
    try {
      const { knex } = await createTenantKnex(tenant);
      const map = await getHuduAssetLayoutTypeMap(knex, tenant);

      const client = await createHuduClient(tenant);
      const layouts = (await client.listAssetLayouts()).map((layout) => ({
        id: layout.id,
        name: layout.name,
        suggestedType: suggestAssetTypeForLayout(layout.name),
        configuredType: map[String(layout.id)] ?? null,
      }));

      return { success: true, data: { layouts, map } };
    } catch (error) {
      logger.error('[HuduLayoutMapActions] getHuduAssetLayoutMap failed', { tenant, error: toErrorMessage(error) });
      return { success: false, error: toErrorMessage(error) };
    }
  }
);

/** F205: validate + persist the map (FR11), preserving sibling settings keys. */
export const setHuduAssetLayoutMap = withHuduSettingsAccess(
  'update',
  async (
    _user,
    { tenant },
    map: HuduAssetLayoutTypeMap
  ): Promise<HuduLayoutMapActionResult<{ map: HuduAssetLayoutTypeMap }>> => {
    try {
      if (!map || typeof map !== 'object' || Array.isArray(map)) {
        return { success: false, error: 'A layout map object is required.' };
      }

      const { knex } = await createTenantKnex(tenant);
      const persisted = await setHuduAssetLayoutTypeMap(knex, tenant, map);

      logger.info('[HuduLayoutMapActions] layout map saved', { tenant, layouts: Object.keys(persisted).length });

      return { success: true, data: { map: persisted } };
    } catch (error) {
      logger.error('[HuduLayoutMapActions] setHuduAssetLayoutMap failed', { tenant, error: toErrorMessage(error) });
      return { success: false, error: toErrorMessage(error) };
    }
  }
);
