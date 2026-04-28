'use server';

import { Knex } from 'knex';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { withAuth, type AuthContext } from '@alga-psa/auth';
import type { Asset, IUserWithRoles } from '@alga-psa/types';

export const getClientAssets = withAuth(async (
  user: IUserWithRoles,
  { tenant }: AuthContext,
): Promise<Asset[]> => {
  if (user.user_type !== 'client') {
    throw new Error('Unauthorized: Invalid user type for client portal');
  }
  if (!user.contact_id) {
    throw new Error('Unauthorized: Contact information not found');
  }

  const { knex } = await createTenantKnex();
  const userContactId = user.contact_id;

  return withTransaction(knex, async (trx: Knex.Transaction): Promise<Asset[]> => {
    const contact = await trx('contacts')
      .where({ contact_name_id: userContactId, tenant })
      .select('client_id')
      .first();

    if (!contact) {
      throw new Error('Unauthorized: Client information not found');
    }

    const assets = await trx('assets')
      .where({ tenant, client_id: contact.client_id })
      .orderBy('updated_at', 'desc');

    return assets.map((asset): Asset => ({
      ...asset,
      created_at:
        asset.created_at instanceof Date
          ? asset.created_at.toISOString()
          : asset.created_at,
      updated_at:
        asset.updated_at instanceof Date
          ? asset.updated_at.toISOString()
          : asset.updated_at,
      purchase_date:
        asset.purchase_date instanceof Date
          ? asset.purchase_date.toISOString()
          : asset.purchase_date,
      warranty_end_date:
        asset.warranty_end_date instanceof Date
          ? asset.warranty_end_date.toISOString()
          : asset.warranty_end_date,
    }));
  });
});
