'use server';

import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import type { Knex } from 'knex';
import type { IClient, IClientLocation } from '@alga-psa/types';
import { withAuth } from '@alga-psa/auth';
import { assertPsaOnlyTenantAccess } from '@shared/services/productAccessGuard';

function tenantScopedTable(conn: Knex | Knex.Transaction, tenant: string, table: string): Knex.QueryBuilder<any, any> {
  return tenantDb(conn, tenant).table(table) as Knex.QueryBuilder<any, any>;
}

export const getAllClientsForAssets = withAuth(async (
  _user,
  { tenant },
  includeInactive: boolean = true
): Promise<IClient[]> => {
  await assertPsaOnlyTenantAccess(tenant, 'asset_rmm_actions');
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const query = tenantScopedTable(trx, tenant, 'clients')
      .select('*')
      .orderBy('client_name', 'asc');

    if (!includeInactive) {
      query.andWhere({ is_inactive: false });
    }

    return query;
  }) as unknown as IClient[];
});

export const getClientByIdForAssets = withAuth(async (
  _user,
  { tenant },
  clientId: string
): Promise<IClient | null> => {
  await assertPsaOnlyTenantAccess(tenant, 'asset_rmm_actions');
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const result = await tenantScopedTable(trx, tenant, 'clients')
      .select('*')
      .where({ client_id: clientId })
      .first();
    return result ?? null;
  }) as unknown as IClient | null;
});

export const getClientLocationsForAssets = withAuth(async (
  _user,
  { tenant },
  clientId: string
): Promise<IClientLocation[]> => {
  await assertPsaOnlyTenantAccess(tenant, 'asset_rmm_actions');
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return tenantScopedTable(trx, tenant, 'client_locations')
      .where({
        client_id: clientId,
        is_active: true,
      })
      .orderBy('is_default', 'desc')
      .orderBy('location_name', 'asc');
  }) as unknown as IClientLocation[];
});
