'use server';

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import type { IProjectMaterial, IService, IServicePrice } from '@alga-psa/types';
import type { Knex } from 'knex';

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
  }
): Promise<IProjectMaterial> => {
  const { knex: db } = await createTenantKnex();

  return withTransaction(db, async (trx: Knex.Transaction) => {
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

    return row as IProjectMaterial;
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
      .select('is_billed')
      .first();

    if (!row) {
      return;
    }

    if (row.is_billed) {
      throw new Error('Cannot delete a billed material.');
    }

    await trx('project_materials')
      .where({ tenant, project_material_id: projectMaterialId })
      .delete();
  });
});
