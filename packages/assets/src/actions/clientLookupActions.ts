'use server';

import { createTenantKnex, withTransaction } from '@alga-psa/db';
import type { Knex } from 'knex';
import type { IClient, IClientLocation } from '@alga-psa/types';
import { withAuth } from '@alga-psa/auth';
import { getClientLogoUrl, getClientLogoUrlsBatch } from '@alga-psa/formatting/avatarUtils';
import { assertPsaOnlyTenantAccess } from '@shared/services/productAccessGuard';

export const getAllClientsForAssets = withAuth(async (
  _user,
  { tenant },
  includeInactive: boolean = true
): Promise<IClient[]> => {
  await assertPsaOnlyTenantAccess(tenant, 'asset_rmm_actions');
  const { knex } = await createTenantKnex();

  const clients = await withTransaction(knex, async (trx: Knex.Transaction) => {
    const query = trx('clients')
      .select('*')
      .where('tenant', tenant)
      .orderBy('client_name', 'asc');

    if (!includeInactive) {
      query.andWhere({ is_inactive: false });
    }

    return query;
  }) as unknown as IClient[];

  if (clients.length === 0) {
    return clients;
  }

  // Batch-resolve logo URLs once (no N+1) so the assets table can show real logos.
  const logoUrlsMap = await getClientLogoUrlsBatch(clients.map((c) => c.client_id), tenant);
  return clients.map((c) => ({ ...c, logoUrl: logoUrlsMap.get(c.client_id) ?? null }));
});

export const getClientByIdForAssets = withAuth(async (
  _user,
  { tenant },
  clientId: string
): Promise<IClient | null> => {
  await assertPsaOnlyTenantAccess(tenant, 'asset_rmm_actions');
  const { knex } = await createTenantKnex();

  const client = await withTransaction(knex, async (trx: Knex.Transaction) => {
    const result = await trx('clients')
      .select('*')
      .where({ client_id: clientId, tenant })
      .first();
    return result ?? null;
  }) as unknown as IClient | null;

  if (!client) {
    return null;
  }

  // Resolve the uploaded logo so the client drawer/detail view shows the real
  // logo (matching the assets table), not just initials.
  const logoUrl = await getClientLogoUrl(clientId, tenant);
  return { ...client, logoUrl };
});

export const getClientLocationsForAssets = withAuth(async (
  _user,
  { tenant },
  clientId: string
): Promise<IClientLocation[]> => {
  await assertPsaOnlyTenantAccess(tenant, 'asset_rmm_actions');
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return trx('client_locations')
      .where({
        client_id: clientId,
        tenant,
        is_active: true,
      })
      .orderBy('is_default', 'desc')
      .orderBy('location_name', 'asc');
  }) as unknown as IClientLocation[];
});
