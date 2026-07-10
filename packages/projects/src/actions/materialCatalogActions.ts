'use server';

import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import type { IProjectMaterial, IService, IServicePrice, IStockUnit } from '@alga-psa/types';
import type { Knex } from 'knex';
import {
  addMaterial,
  deleteMaterial,
  listMaterials,
  MaterialValidationError,
  queryAvailableStockUnits,
  queryCatalogPickerItems,
  queryServicePrices,
} from '@alga-psa/inventory/lib';
import { InsufficientStockError } from '@alga-psa/inventory/lib/consume';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

type ProjectMaterialActionError = ActionMessageError | ActionPermissionError;

function projectMaterialActionErrorFrom(error: unknown): ProjectMaterialActionError | null {
  if (error instanceof Error) {
    if (error.message.includes('Permission denied')) {
      return permissionError(error.message);
    }
    if (
      error instanceof MaterialValidationError ||
      error instanceof InsufficientStockError ||
      error.message === 'Cannot delete a billed material.'
    ) {
      return actionError(error.message);
    }
  }

  const dbError = error as { code?: string; column?: string };
  if (dbError?.code === '23502') {
    return actionError(`Missing required material field${dbError.column ? `: ${dbError.column}` : ''}.`);
  }
  if (dbError?.code === '23503') {
    return actionError('The selected project, client, product, or stock unit is no longer valid. Please refresh and try again.');
  }

  return null;
}

export interface CatalogPickerSearchOptions {
  search?: string;
  page?: number;
  limit?: number;
  is_active?: boolean;
  item_kinds?: Array<'service' | 'product'>;
  billing_methods?: Array<'fixed' | 'hourly' | 'usage' | 'per_unit'>;
}

export type CatalogPickerItem = Pick<
  IService,
  'service_id' | 'service_name' | 'billing_method' | 'unit_of_measure' | 'item_kind' | 'sku'
> & {
  default_rate: number;
} & import('@alga-psa/inventory/lib/integrationTypes').PickerStockFields;

export const searchServiceCatalogForPicker = withAuth(async (
  _user,
  { tenant },
  options: CatalogPickerSearchOptions = {}
): Promise<{ items: CatalogPickerItem[]; totalCount: number }> => {
  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    const { items, totalCount } = await queryCatalogPickerItems(trx, tenant, options);
    return { items: items as CatalogPickerItem[], totalCount };
  });
});

export const getServicePrices = withAuth(async (
  _user,
  { tenant },
  serviceId: string
): Promise<IServicePrice[]> => {
  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    return queryServicePrices(trx, tenant, serviceId);
  });
});

export const listProjectMaterials = withAuth(async (
  user,
  { tenant },
  projectId: string
): Promise<IProjectMaterial[] | ProjectMaterialActionError> => {
  try {
    if (!await hasPermission(user, 'project', 'read')) {
      return permissionError('Permission denied: project read required');
    }
    const { knex: db } = await createTenantKnex();
    return (await listMaterials(db, tenant, 'project', projectId)) as IProjectMaterial[];
  } catch (error) {
    const expected = projectMaterialActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

export const addProjectMaterial = withAuth(async (
  user,
  { tenant },
  input: {
    project_id: string;
    client_id: string;
    service_id: string;
    quantity: number;
    rate: number;
    currency_code: string;
    description?: string | null;
    unit_id?: string | null; // serialized: the picked stock unit to deliver
  }
): Promise<IProjectMaterial | ProjectMaterialActionError> => {
  try {
    if (!await hasPermission(user, 'project', 'update')) {
      return permissionError('Permission denied: project update required');
    }
    const { knex: db } = await createTenantKnex();
    return (await addMaterial(
      db,
      tenant,
      { ...input, parent_type: 'project', parent_id: input.project_id },
      (user as any)?.user_id ?? null,
    )) as IProjectMaterial;
  } catch (error) {
    const expected = projectMaterialActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

/** In-stock serialized units available to pick when adding a serialized product as a material. */
export const listAvailableStockUnitsForMaterial = withAuth(async (
  user,
  { tenant },
  serviceId: string
): Promise<IStockUnit[]> => {
  if (!(await hasPermission(user, 'inventory', 'read'))) return [];
  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    return queryAvailableStockUnits(trx, tenant, serviceId);
  });
});

export const deleteProjectMaterial = withAuth(async (
  user,
  { tenant },
  projectMaterialId: string
): Promise<void | ProjectMaterialActionError> => {
  try {
    if (!await hasPermission(user, 'project', 'update')) {
      return permissionError('Permission denied: project update required');
    }
    const { knex: db } = await createTenantKnex();
    await deleteMaterial(db, tenant, 'project', projectMaterialId, (user as any)?.user_id ?? null);
  } catch (error) {
    const expected = projectMaterialActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});
