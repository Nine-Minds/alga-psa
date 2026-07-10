'use server';

import { createTenantKnex, withTransaction } from '@alga-psa/db';
import type { Knex } from 'knex';
import type { IContact } from '@alga-psa/types';
import type { ContactFilterStatus } from '@alga-psa/shared/ticketClients/types';
import { getContactsByClient as getContactsByClientModel } from '@alga-psa/shared/ticketClients/contacts';
import { withAuth } from '@alga-psa/auth/withAuth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { permissionError, type ActionPermissionError } from '@alga-psa/ui/lib/errorHandling';

export const getQuoteRecipientContacts = withAuth(async (
  user,
  { tenant },
  clientId: string,
  status: ContactFilterStatus = 'active',
): Promise<IContact[] | ActionPermissionError> => {
  if (!await hasPermission(user, 'billing', 'read')) {
    return permissionError('Permission denied: billing read required');
  }
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return getContactsByClientModel(trx, tenant, clientId, status);
  });
});
