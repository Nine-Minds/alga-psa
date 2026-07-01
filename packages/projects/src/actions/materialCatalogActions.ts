'use server';

import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import type { IProjectMaterial, IService, IServicePrice, IStockUnit } from '@alga-psa/types';
import type { Knex } from 'knex';
import { recordStockConsumption, reverseStockConsumption, createAndLinkDeliveredAsset } from '@alga-psa/inventory/lib';

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
};

export const searchServiceCatalogForPicker = withAuth(async (
  _user,
  { tenant },
  options: CatalogPickerSearchOptions = {}
): Promise<{ items: CatalogPickerItem[]; totalCount: number }> => {
  const { knex: db } = await createTenantKnex();
  const page = options.page ?? 1;
  const limit = options.limit ?? 10;
  const offset = (page - 1) * limit;
  const searchTerm = options.search?.trim() ? `%${options.search.trim()}%` : null;

  return withTransaction(db, async (trx: Knex.Transaction) => {
    const base = trx('service_catalog as sc').where({ 'sc.tenant': tenant });

    if (options.is_active !== undefined) {
      base.andWhere('sc.is_active', options.is_active);
    }

    if (options.item_kinds?.length) {
      base.andWhere((qb) => qb.whereIn('sc.item_kind', options.item_kinds!));
    }

    if (options.billing_methods?.length) {
      base.andWhere((qb) => qb.whereIn('sc.billing_method', options.billing_methods!));
    }

    if (searchTerm) {
      base.andWhere((qb) => {
        qb.whereILike('sc.service_name', searchTerm)
          .orWhereILike('sc.description', searchTerm)
          .orWhereILike('sc.sku', searchTerm);
      });
    }

    const countResult = await base.clone().count('sc.service_id as count').first();
    const totalCount = parseInt(countResult?.count as string) || 0;

    const rows = await base
      .clone()
      .select(
        'sc.service_id',
        'sc.service_name',
        'sc.billing_method',
        'sc.unit_of_measure',
        'sc.item_kind',
        'sc.sku',
        trx.raw('CAST(sc.default_rate AS FLOAT) as default_rate')
      )
      .orderBy('sc.service_name', 'asc')
      .limit(limit)
      .offset(offset);

    return {
      items: rows as CatalogPickerItem[],
      totalCount,
    };
  });
});

export const getServicePrices = withAuth(async (
  _user,
  { tenant },
  serviceId: string
): Promise<IServicePrice[]> => {
  const { knex: db } = await createTenantKnex();

  return withTransaction(db, async (trx: Knex.Transaction) => {
    const rows = await trx('service_prices')
      .where({ tenant, service_id: serviceId })
      .select('*')
      .orderBy('currency_code', 'asc');

    return rows as IServicePrice[];
  });
});

export const listProjectMaterials = withAuth(async (
  _user,
  { tenant },
  projectId: string
): Promise<IProjectMaterial[]> => {
  const { knex: db } = await createTenantKnex();

  return withTransaction(db, async (trx: Knex.Transaction) => {
    const rows = await trx('project_materials as pm')
      .leftJoin('service_catalog as sc', function () {
        this.on('pm.service_id', '=', 'sc.service_id').andOn('pm.tenant', '=', 'sc.tenant');
      })
      .where({ 'pm.tenant': tenant, 'pm.project_id': projectId })
      .select('pm.*', 'sc.service_name as service_name', 'sc.sku as sku')
      .orderBy('pm.created_at', 'desc');

    return rows as IProjectMaterial[];
  });
});

export const addProjectMaterial = withAuth(async (
  _user,
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
  const { knex: db } = await createTenantKnex();

  const { row, pendingAsset } = await withTransaction(db, async (trx: Knex.Transaction) => {
    const [row] = await trx('project_materials')
      .insert({
        tenant,
        project_id: input.project_id,
        client_id: input.client_id,
        service_id: input.service_id,
        quantity: Math.max(1, Math.floor(input.quantity || 1)),
        rate: Math.max(0, Math.round(input.rate || 0)),
        currency_code: input.currency_code || 'USD',
        description: input.description ?? null,
        is_billed: false,
      })
      .returning('*');

    // Inventory: decrement stock for track_stock products (serialized delivers the picked unit). No-op otherwise.
    const consumption = await recordStockConsumption(trx, tenant, {
      service_id: row.service_id,
      quantity: row.quantity,
      source_doc_type: 'project_material',
      source_doc_id: row.project_material_id,
      performed_by: (_user as any)?.user_id ?? null,
      unit_id: input.unit_id ?? null,
      client_id: input.client_id,
    });

    return { row, pendingAsset: consumption.pending_asset_link ?? null };
  });

  // F044: a serialized install creates the managed asset like SO fulfillment does —
  // after commit (F029), and never failing the material itself.
  if (pendingAsset) {
    try {
      await createAndLinkDeliveredAsset(db, tenant, pendingAsset);
    } catch (e) {
      console.error('Asset creation for delivered project-material unit failed:', e);
    }
  }
  return row as IProjectMaterial;
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
    return (await trx('stock_units')
      .where({ tenant, service_id: serviceId, status: 'in_stock' })
      .orderBy('received_at', 'asc')) as IStockUnit[];
  });
});

export const deleteProjectMaterial = withAuth(async (
  _user,
  { tenant },
  projectMaterialId: string
): Promise<void> => {
  const { knex: db } = await createTenantKnex();

  return withTransaction(db, async (trx: Knex.Transaction) => {
    const row = await trx('project_materials')
      .where({ tenant, project_material_id: projectMaterialId })
      .select('is_billed', 'service_id', 'quantity')
      .first();

    if (!row) {
      return;
    }

    if (row.is_billed) {
      throw new Error('Cannot delete a billed material.');
    }

    // Inventory: restore stock consumed when this (unbilled) material was added.
    await reverseStockConsumption(trx, tenant, {
      service_id: row.service_id,
      quantity: row.quantity,
      source_doc_type: 'project_material',
      source_doc_id: projectMaterialId,
      performed_by: (_user as any)?.user_id ?? null,
    });

    await trx('project_materials')
      .where({ tenant, project_material_id: projectMaterialId })
      .delete();
  });
});
