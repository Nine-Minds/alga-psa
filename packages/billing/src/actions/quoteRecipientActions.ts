'use server';

import { createTenantKnex, withTransaction } from '@alga-psa/db';
import type { Knex } from 'knex';
import type { IContact } from '@alga-psa/types';
import type { ContactFilterStatus } from '@alga-psa/shared/ticketClients/types';
import { getContactsByClient as getContactsByClientModel } from '@alga-psa/shared/ticketClients/contacts';
import { withAuth } from '@alga-psa/auth/withAuth';

export const getQuoteRecipientContacts = withAuth(async (
  _user,
  { tenant },
  clientId: string,
  status: ContactFilterStatus = 'active',
): Promise<IContact[]> => {
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return getContactsByClientModel(trx, tenant, clientId, status);
  });
});
