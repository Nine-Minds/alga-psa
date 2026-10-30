'use server';

import type {
  AssetStatus,
  CreateAssetStatusInput,
  UpdateAssetStatusInput,
} from '@alga-psa/types';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import {
  archiveAssetStatusRow,
  createAssetStatusRow,
  listAssetStatusRows,
  reorderAssetStatusRows,
  restoreAssetStatusRow,
  updateAssetStatusRow,
  type AssetStatusRegistryError,
  type AssetStatusRegistryResult,
} from '../lib/assetStatusRegistry';
import {
  permissionError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

export type AssetStatusActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: AssetStatusRegistryError };

export type AssetStatusPermissionError = ActionPermissionError;

function toActionResult<T>(result: AssetStatusRegistryResult<T>): AssetStatusActionResult<T> {
  if (result.ok) {
    return { success: true, data: result.value };
  }
  // ee/server typechecks with strict:false, where the false branch of a
  // boolean-discriminated union does not narrow — pin the failure member.
  return { success: false, error: (result as Extract<AssetStatusRegistryResult<T>, { ok: false }>).error };
}

/** Status settings follow `settings` update, like the asset type registry. */
async function canManageAssetStatuses(user: Parameters<typeof hasPermission>[0]): Promise<boolean> {
  return hasPermission(user, 'system_settings', 'update');
}

export const listAssetStatuses = withAuth(async (
  user,
  { tenant },
  options?: { includeArchived?: boolean; withUsage?: boolean }
): Promise<AssetStatus[] | AssetStatusPermissionError> => {
  const { knex } = await createTenantKnex();

  if (!await hasPermission(user, 'asset', 'read')) {
    return permissionError('Permission denied: Cannot read asset statuses', 'msp/assets:errors.permissions.readAssetStatuses');
  }

  return listAssetStatusRows(knex, tenant, options);
});

export const createAssetStatus = withAuth(async (
  user,
  { tenant },
  data: CreateAssetStatusInput
): Promise<AssetStatusActionResult<AssetStatus> | AssetStatusPermissionError> => {
  const { knex } = await createTenantKnex();

  if (!await canManageAssetStatuses(user)) {
    return permissionError('Permission denied: Cannot manage asset statuses', 'msp/assets:errors.permissions.manageAssetStatuses');
  }

  return withTransaction(knex, async (trx: Knex.Transaction) =>
    toActionResult(await createAssetStatusRow(trx, tenant, data))
  );
});

export const updateAssetStatus = withAuth(async (
  user,
  { tenant },
  statusId: string,
  data: UpdateAssetStatusInput
): Promise<AssetStatusActionResult<AssetStatus> | AssetStatusPermissionError> => {
  const { knex } = await createTenantKnex();

  if (!await canManageAssetStatuses(user)) {
    return permissionError('Permission denied: Cannot manage asset statuses', 'msp/assets:errors.permissions.manageAssetStatuses');
  }

  return withTransaction(knex, async (trx: Knex.Transaction) =>
    toActionResult(await updateAssetStatusRow(trx, tenant, statusId, data))
  );
});

/**
 * Persists a dragged order in one transaction: the status selects everywhere
 * read `display_order`, so a half-written order would reshuffle every form.
 */
export const reorderAssetStatuses = withAuth(async (
  user,
  { tenant },
  orderedIds: string[]
): Promise<AssetStatusActionResult<AssetStatus[]> | AssetStatusPermissionError> => {
  const { knex } = await createTenantKnex();

  if (!await canManageAssetStatuses(user)) {
    return permissionError('Permission denied: Cannot manage asset statuses', 'msp/assets:errors.permissions.manageAssetStatuses');
  }

  return withTransaction(knex, async (trx: Knex.Transaction) =>
    toActionResult(await reorderAssetStatusRows(trx, tenant, orderedIds))
  );
});

/**
 * Archive, never delete. Refused with the in-use count while assets still
 * carry the slug (FR-B4).
 */
export const archiveAssetStatus = withAuth(async (
  user,
  { tenant },
  statusId: string
): Promise<AssetStatusActionResult<{ status: AssetStatus; in_use_count: number }> | AssetStatusPermissionError> => {
  const { knex } = await createTenantKnex();

  if (!await canManageAssetStatuses(user)) {
    return permissionError('Permission denied: Cannot manage asset statuses', 'msp/assets:errors.permissions.manageAssetStatuses');
  }

  return withTransaction(knex, async (trx: Knex.Transaction) =>
    toActionResult(await archiveAssetStatusRow(trx, tenant, statusId))
  );
});

/** FR-B4: an archived status can come back; it was never deleted. */
export const restoreAssetStatus = withAuth(async (
  user,
  { tenant },
  statusId: string
): Promise<AssetStatusActionResult<AssetStatus> | AssetStatusPermissionError> => {
  const { knex } = await createTenantKnex();

  if (!await canManageAssetStatuses(user)) {
    return permissionError('Permission denied: Cannot manage asset statuses', 'msp/assets:errors.permissions.manageAssetStatuses');
  }

  return withTransaction(knex, async (trx: Knex.Transaction) =>
    toActionResult(await restoreAssetStatusRow(trx, tenant, statusId))
  );
});
