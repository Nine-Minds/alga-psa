'use server';

import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import type { IService, IServicePrice, ITicketMaterial, IStockUnit } from '@alga-psa/types';
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

export const listTicketMaterials = withAuth(async (
  user,
  { tenant },
  ticketId: string
): Promise<ITicketMaterial[]> => {
  if (!await hasPermission(user, 'ticket', 'read')) {
    throw new Error('Permission denied: ticket read required');
  }
  const { knex: db } = await createTenantKnex();
  return (await listMaterials(db, tenant, 'ticket', ticketId)) as ITicketMaterial[];
});

export const addTicketMaterial = withAuth(async (
  user,
  { tenant },
  input: {
    ticket_id: string;
    client_id: string;
    service_id: string;
    quantity: number;
    rate: number;
    currency_code: string;
    description?: string | null;
    unit_id?: string | null; // serialized: the picked stock unit to deliver
  }
): Promise<ITicketMaterial> => {
  if (!await hasPermission(user, 'ticket', 'update')) {
    throw new Error('Permission denied: ticket update required');
  }
  const { knex: db } = await createTenantKnex();
  return (await addMaterial(
    db,
    tenant,
    { ...input, parent_type: 'ticket', parent_id: input.ticket_id },
    (user as any)?.user_id ?? null,
  )) as ITicketMaterial;
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

export const deleteTicketMaterial = withAuth(async (
  user,
  { tenant },
  ticketMaterialId: string
): Promise<void> => {
  if (!await hasPermission(user, 'ticket', 'update')) {
    throw new Error('Permission denied: ticket update required');
  }
  const { knex: db } = await createTenantKnex();
  await deleteMaterial(db, tenant, 'ticket', ticketMaterialId, (user as any)?.user_id ?? null);
});
