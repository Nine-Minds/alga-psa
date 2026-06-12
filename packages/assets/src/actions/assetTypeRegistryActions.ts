'use server';

import type {
  AssetTypeRegistryEntry,
  CreateAssetTypeInput,
  UpdateAssetTypeInput,
} from '@alga-psa/types';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import {
  createAssetType,
  deleteAssetType,
  getAssetTypeBySlug,
  listAssetTypes,
  updateAssetType,
  type AssetTypeRegistryError,
  type AssetTypeRegistryResult,
} from '../lib/assetTypeRegistry';

export type AssetTypeRegistryActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: AssetTypeRegistryError };

function toActionResult<T>(result: AssetTypeRegistryResult<T>): AssetTypeRegistryActionResult<T> {
  return result.ok
    ? { success: true, data: result.value }
    : { success: false, error: result.error };
}

export const getAssetTypes = withAuth(async (user, { tenant }): Promise<AssetTypeRegistryEntry[]> => {
  const { knex } = await createTenantKnex();

  if (!await hasPermission(user, 'asset', 'read')) {
    throw new Error('Permission denied: Cannot read asset types');
  }

  return listAssetTypes(knex, tenant);
});

export const getAssetType = withAuth(async (user, { tenant }, slug: string): Promise<AssetTypeRegistryEntry | null> => {
  const { knex } = await createTenantKnex();

  if (!await hasPermission(user, 'asset', 'read')) {
    throw new Error('Permission denied: Cannot read asset types');
  }

  return getAssetTypeBySlug(knex, tenant, slug);
});

export const createAssetTypeAction = withAuth(async (
  user,
  { tenant },
  data: CreateAssetTypeInput
): Promise<AssetTypeRegistryActionResult<AssetTypeRegistryEntry>> => {
  const { knex } = await createTenantKnex();

  if (!await hasPermission(user, 'asset', 'update')) {
    throw new Error('Permission denied: Cannot manage asset types');
  }

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return toActionResult(await createAssetType(trx, tenant, data));
  });
});

export const updateAssetTypeAction = withAuth(async (
  user,
  { tenant },
  slug: string,
  data: UpdateAssetTypeInput
): Promise<AssetTypeRegistryActionResult<AssetTypeRegistryEntry>> => {
  const { knex } = await createTenantKnex();

  if (!await hasPermission(user, 'asset', 'update')) {
    throw new Error('Permission denied: Cannot manage asset types');
  }

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return toActionResult(await updateAssetType(trx, tenant, slug, data));
  });
});

export const deleteAssetTypeAction = withAuth(async (
  user,
  { tenant },
  slug: string
): Promise<AssetTypeRegistryActionResult<{ slug: string }>> => {
  const { knex } = await createTenantKnex();

  if (!await hasPermission(user, 'asset', 'update')) {
    throw new Error('Permission denied: Cannot manage asset types');
  }

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return toActionResult(await deleteAssetType(trx, tenant, slug));
  });
});
