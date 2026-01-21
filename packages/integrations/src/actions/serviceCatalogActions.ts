'use server';

import type { IService } from '@alga-psa/types';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import type { Knex } from 'knex';
import { getCurrentUser } from '@alga-psa/users/actions';

export interface PaginatedServicesResponse {
  services: IService[];
  totalCount: number;
  page: number;
  pageSize: number;
}

export interface ServiceListOptions {
  /**
   * Catalog kind filter.
   * - Omit to preserve legacy behavior (services only).
   * - Use 'product' for product-only lists.
   * - Use 'any' to include both services and products.
   */
  item_kind?: 'service' | 'product' | 'any';
}

export async function getServices(
  page: number = 1,
  pageSize: number = 999,
  options: ServiceListOptions = {}
): Promise<PaginatedServicesResponse> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  if (!currentUser.tenant) {
    throw new Error('Tenant is required');
  }

  const { knex: db, tenant } = await createTenantKnex(currentUser.tenant);
  if (!tenant) {
    throw new Error('SYSTEM_ERROR: Tenant context not found');
  }

  const itemKind = options.item_kind ?? 'service';

  return withTransaction(db, async (trx: Knex.Transaction) => {
    const offset = (page - 1) * pageSize;

    const base = trx('service_catalog as sc').where({ 'sc.tenant': tenant });
    if (itemKind !== 'any') {
      base.andWhere('sc.item_kind', itemKind);
    }

    const countRow = await base.clone().count('* as count').first();
    const totalCount = parseInt((countRow?.count as any) ?? '0', 10);

    const services = (await base
      .clone()
      .select('sc.*')
      .orderBy('sc.service_name', 'asc')
      .limit(pageSize)
      .offset(offset)) as unknown as IService[];

    return { services, totalCount, page, pageSize };
  });
}
