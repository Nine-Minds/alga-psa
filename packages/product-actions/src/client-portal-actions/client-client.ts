"use server";

import { withTransaction } from '@alga-psa/shared/db';
import { Knex } from 'knex';
import { createTenantKnex } from '@server/lib/db';
import { getCurrentUser, getUserClientId } from '@product/actions/user-actions/userActions';
import Client from '@server/lib/models/client';
import { getClientLogoUrl } from '@server/lib/utils/avatarUtils';
import type { IClient } from 'server/src/interfaces/client.interfaces';

/**
 * Get the current client user's client without RBAC checks intended for MSP screens.
 * This action is specifically for client portal internal use.
 */
export async function getClientClient(): Promise<IClient | null> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('Unauthorized');
  }

  const clientId = await getUserClientId(user.user_id);
  if (!clientId) {
    return null; // No associated client
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  // Client.getById enforces tenant scoping internally (WHERE tenant = currentTenant)
  // which is required for Citus/pooled connections to avoid cross-shard scans.
  const client = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await Client.getById(trx, clientId);
  });

  if (!client) return null;

  // Optionally include the logo URL for richer UI
  const logoUrl = await getClientLogoUrl(clientId, tenant);

  return { ...client, logoUrl } as IClient;
}
