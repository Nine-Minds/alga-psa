'use server';

/**
 * Hudu asset-layout→asset-type map server actions (EE-only, Phase 2 FR11).
 *
 * get/set for `hudu_integrations.settings.asset_layout_type_map`. Gating
 * mirrors huduActions (withHuduSettingsAccess): EE tier and
 * `system_settings` RBAC (read=view, update=persist) — enforced on every
 * action.
 */

import logger from '@alga-psa/core/logger';
import { withAuth, hasPermission } from '@alga-psa/auth';
import type { IUserWithRoles } from '@alga-psa/types';
import { TIER_FEATURES } from '@alga-psa/types';
import { assertTierAccess } from 'server/src/lib/tier-gating/assertTierAccess';
import { createTenantKnex } from 'server/src/lib/db';
import { createAssetType, listAssetTypes } from '@alga-psa/assets/lib/assetTypeRegistry';
import type {
  AssetTypeRegistryError,
  AssetTypeRegistryResult,
} from '@alga-psa/assets/lib/assetTypeRegistry';
import type { AssetTypeRegistryEntry } from '@alga-psa/types';
import { createHuduClient } from '../../integrations/hudu/huduClient';
import {
  getHuduAssetLayoutTypeMap,
  setHuduAssetLayoutTypeMap,
  suggestAssetTypeForLayout,
} from '../../integrations/hudu/assetLayoutMap';
import type {
  AlgaAssetType,
  HuduAssetLayoutTypeMap,
  HuduLayoutAssignment,
} from '../../integrations/hudu/assetLayoutMap';
import { buildFieldsSchemaFromHuduLayout } from '../../integrations/hudu/layoutFieldSchema';
import { huduActionErrorMessage } from './huduActionErrors';

export type HuduLayoutMapActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export interface HuduAssetLayoutMapEntry {
  id: number;
  name: string;
  suggestedType: AlgaAssetType;
  configuredType: HuduLayoutAssignment | null;
}

/** F315: registry projection the settings select offers (built-ins + customs). */
export interface HuduAssetTypeOption {
  slug: string;
  name: string;
  is_builtin: boolean;
}

export interface HuduAssetLayoutMapData {
  layouts: HuduAssetLayoutMapEntry[];
  map: HuduAssetLayoutTypeMap;
  types: HuduAssetTypeOption[];
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

// Explicit type guard: the EE tsconfig is non-strict, where `!result.ok`
// alone does not narrow the discriminated union.
function isRegistryFailure<T>(
  result: AssetTypeRegistryResult<T>
): result is { ok: false; error: AssetTypeRegistryError } {
  return !result.ok;
}

/**
 * F205/F315: live asset layouts joined with the stored map; each layout
 * carries a heuristic suggestion (FR12) and the configured type when one is
 * stored. `types` is the tenant's asset type registry (built-ins + customs)
 * so the settings select can target any registered type.
 */
export const getHuduAssetLayoutMap = withHuduSettingsAccess(
  'read',
  async (_user, { tenant }): Promise<HuduLayoutMapActionResult<HuduAssetLayoutMapData>> => {
    try {
      const { knex } = await createTenantKnex(tenant);
      const map = await getHuduAssetLayoutTypeMap(knex, tenant);
      const types = (await listAssetTypes(knex, tenant)).map(({ slug, name, is_builtin }) => ({
        slug,
        name,
        is_builtin,
      }));

      const client = await createHuduClient(tenant);
      const layouts = (await client.listAssetLayouts()).map((layout) => ({
        id: layout.id,
        name: layout.name,
        suggestedType: suggestAssetTypeForLayout(layout.name),
        configuredType: map[String(layout.id)] ?? null,
      }));

      return { success: true, data: { layouts, map, types } };
    } catch (error) {
      logger.error('[HuduLayoutMapActions] getHuduAssetLayoutMap failed', { tenant, error: toErrorMessage(error) });
      return { success: false, error: huduActionErrorMessage(error, 'Unable to load Hudu asset layout mappings. Please try again.') };
    }
  }
);

export type HuduCreateTypeFromLayoutErrorCode =
  | 'slug_conflict'
  | 'reserved_slug'
  | 'invalid_name'
  | 'invalid_schema';

export type HuduCreateTypeFromLayoutResult =
  | { success: true; data: { type: AssetTypeRegistryEntry; map: HuduAssetLayoutTypeMap } }
  | { success: false; error: string; code?: HuduCreateTypeFromLayoutErrorCode; slug?: string };

export interface CreateAssetTypeFromHuduLayoutInput {
  layoutId: number | string;
}

/**
 * F316: one action — fetch the layout's field definitions, mirror them into a
 * new custom asset type (name = layout name, slug auto), then store the
 * layoutId→slug assignment. Slug conflicts surface typed for the UI.
 */
export const createAssetTypeFromHuduLayout = withHuduSettingsAccess(
  'update',
  async (
    _user,
    { tenant },
    input: CreateAssetTypeFromHuduLayoutInput
  ): Promise<HuduCreateTypeFromLayoutResult> => {
    try {
      const layoutId = input?.layoutId;
      if (layoutId === undefined || layoutId === null || layoutId === '') {
        return { success: false, error: 'layoutId is required.' };
      }

      const client = await createHuduClient(tenant);
      const layout = await client.getAssetLayout(Number(layoutId));
      const fieldsSchema = buildFieldsSchemaFromHuduLayout(layout?.fields);

      const { knex } = await createTenantKnex(tenant);
      const created = await createAssetType(knex, tenant, {
        name: layout.name,
        fields_schema: fieldsSchema,
      });
      if (isRegistryFailure(created)) {
        const { error } = created;
        const slug = 'slug' in error ? error.slug : undefined;
        switch (error.code) {
          case 'slug_conflict':
          case 'reserved_slug':
            return {
              success: false,
              error: `An asset type already exists for slug "${slug}".`,
              code: error.code,
              slug,
            };
          case 'invalid_name':
            return { success: false, error: error.message, code: 'invalid_name' };
          case 'invalid_schema':
            return {
              success: false,
              error: `The generated schema is invalid: ${error.issues.map((issue) => issue.message).join('; ')}`,
              code: 'invalid_schema',
            };
          default:
            return { success: false, error: `Failed to create the asset type (${error.code}).` };
        }
      }

      const createdType = created.value;
      const current = await getHuduAssetLayoutTypeMap(knex, tenant);
      const map = await setHuduAssetLayoutTypeMap(knex, tenant, {
        ...current,
        [String(layoutId)]: createdType.slug,
      });

      logger.info('[HuduLayoutMapActions] asset type created from layout', {
        tenant,
        layoutId: String(layoutId),
        slug: createdType.slug,
        fields: createdType.fields_schema.length,
      });

      return { success: true, data: { type: createdType, map } };
    } catch (error) {
      logger.error('[HuduLayoutMapActions] createAssetTypeFromHuduLayout failed', {
        tenant,
        error: toErrorMessage(error),
      });
      return { success: false, error: huduActionErrorMessage(error, 'Unable to create an asset type from the Hudu layout. Please try again.') };
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
      return { success: false, error: huduActionErrorMessage(error, 'Unable to save Hudu asset layout mappings. Please try again.') };
    }
  }
);
