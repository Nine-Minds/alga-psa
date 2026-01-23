'use server';

import type { IService } from '@alga-psa/types';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import type { Knex } from 'knex';
import { withAuth } from '@alga-psa/auth';

export interface PaginatedServicesResponse {
  services: IService[];
  totalCount: number;
  page: number;
  pageSize: number;
}

export const getServices = withAuth(async (_user, { tenant }, page: number = 1, pageSize: number = 999): Promise<PaginatedServicesResponse> => {
  const { knex: db } = await createTenantKnex();

  return withTransaction(db, async (trx: Knex.Transaction) => {
    const offset = (page - 1) * pageSize;

    const base = trx('service_catalog as sc').where({ 'sc.tenant': tenant, 'sc.item_kind': 'service' });

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
});
