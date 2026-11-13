import { withTransaction, tenantDb } from '@alga-psa/db';
import { hasPermission } from '@alga-psa/auth';
import type { IUserWithRoles } from '@alga-psa/types';
import { isClientUserType } from '@alga-psa/types';
import type { Knex } from 'knex';

/** Canonical record-level policy for contact avatar mutations in either portal. */
export async function canManageContactAvatar(
  currentUser: IUserWithRoles,
  tenant: string,
  contactId: string,
  knex: Knex
): Promise<boolean> {
  if (currentUser.user_type === 'internal') {
    return hasPermission(currentUser, 'contact', 'update', knex);
  }

  if (!isClientUserType(currentUser.user_type)) {
    return false;
  }

  if (currentUser.contact_id === contactId) {
    return true;
  }

  const linkedUser = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return tenantDb(trx, tenant).table('users')
      .select('user_id')
      .where({ contact_id: contactId, user_id: currentUser.user_id })
      .first();
  });

  return !!linkedUser;
}
