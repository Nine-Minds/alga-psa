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
  queryAvailableStockUnits,
  queryCatalogPickerItems,
  queryServicePrices,
} from '@alga-psa/inventory/lib';

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
): Promise<IProjectMaterial[]> => {
  if (!await hasPermission(user, 'project', 'read')) {
    throw new Error('Permission denied: project read required');
  }
  const { knex: db } = await createTenantKnex();
  return (await listMaterials(db, tenant, 'project', projectId)) as IProjectMaterial[];
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
): Promise<IProjectMaterial> => {
  if (!await hasPermission(user, 'project', 'update')) {
    throw new Error('Permission denied: project update required');
  }
  const { knex: db } = await createTenantKnex();
  return (await addMaterial(
    db,
    tenant,
    { ...input, parent_type: 'project', parent_id: input.project_id },
    (user as any)?.user_id ?? null,
  )) as IProjectMaterial;
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
): Promise<void> => {
  if (!await hasPermission(user, 'project', 'update')) {
    throw new Error('Permission denied: project update required');
  }
  const { knex: db } = await createTenantKnex();
  await deleteMaterial(db, tenant, 'project', projectMaterialId, (user as any)?.user_id ?? null);
});
