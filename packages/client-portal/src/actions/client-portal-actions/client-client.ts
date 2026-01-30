"use server";

import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { createTenantKnex } from '@alga-psa/db';
import Client from '@alga-psa/clients/models/client';
import { getClientLogoUrl } from '@alga-psa/documents/lib/avatarUtils';
import type { IClient, IUserWithRoles } from '@alga-psa/types';
import { withAuth, type AuthContext } from '@alga-psa/auth';

/**
 * Get the current client user's client without RBAC checks intended for MSP screens.
 * This action is specifically for client portal internal use.
 */
export const getClientClient = withAuth(async (
  user: IUserWithRoles,
  { tenant }: AuthContext
): Promise<IClient | null> => {
  const { knex } = await createTenantKnex();

  // Use a single transaction to get the client ID and client data
  // This avoids nested withAuth calls which can exhaust the connection pool
  const result = await withTransaction(knex, async (trx: Knex.Transaction) => {
    // Get client ID from contact if user is contact-based
    let clientId: string | null = null;

    if (user.contact_id) {
      const contact = await trx('contacts')
        .where({
          contact_name_id: user.contact_id,
          tenant
        })
        .select('client_id')
        .first();

      clientId = contact?.client_id || null;
    }

    if (!clientId) {
      return null; // No associated client
    }

    // Get the client data
    return await Client.getById(trx, tenant, clientId);
  });

  if (!result) return null;

  // Get logo URL outside the transaction (it's a separate operation)
  const logoUrl = await getClientLogoUrl(result.client_id, tenant);

  return { ...result, logoUrl } as IClient;
});
