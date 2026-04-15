'use server'

import type { IContact } from '@alga-psa/types';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { Knex } from 'knex';
import { hasPermission } from '../lib/permissions';
import { getContactAvatarUrlsBatchAction } from './avatarActions';

export type ContactFilterStatus = 'active' | 'inactive' | 'all';

/**
 * Lightweight contact query for picker/dropdown UIs.
 * Returns contacts with client names and avatar URLs, without phone hydration.
 * For full contact data including phone numbers, use @alga-psa/clients/actions getAllContacts.
 */
export const getContactsForPicker = withAuth(async (
  user,
  { tenant },
  status: ContactFilterStatus = 'active',
  sortBy: string = 'full_name',
  sortDirection: 'asc' | 'desc' = 'asc'
): Promise<IContact[]> => {
  if (!await hasPermission(user, 'contact', 'read')) {
    throw new Error('Permission denied: Cannot read contacts');
  }

  const { knex: db } = await createTenantKnex();

  const allowedSortBy = ['full_name', 'created_at', 'email', 'client_name'];
  const safeSortBy = allowedSortBy.includes(sortBy) ? sortBy : 'full_name';
  const safeSortDirection = sortDirection === 'desc' ? 'desc' : 'asc';

  const contacts = await withTransaction(db, async (trx: Knex.Transaction) => {
    const dbSortBy = safeSortBy === 'client_name' ? 'full_name' : `contacts.${safeSortBy}`;

    return trx('contacts')
      .select('contacts.*', 'clients.client_name')
      .leftJoin('clients', function (this: Knex.JoinClause) {
        this.on('contacts.client_id', 'clients.client_id')
          .andOn('clients.tenant', 'contacts.tenant');
      })
      .where('contacts.tenant', tenant)
      .modify(function (queryBuilder: Knex.QueryBuilder) {
        if (status !== 'all') {
          queryBuilder.where('contacts.is_inactive', status === 'inactive');
        }
      })
      .orderBy(dbSortBy, safeSortDirection);
  });

  const contactIds = contacts.map((c: IContact) => c.contact_name_id);
  const avatarUrlsMap = await getContactAvatarUrlsBatchAction(contactIds, tenant);

  return contacts.map((contact: IContact) => ({
    ...contact,
    avatarUrl: avatarUrlsMap.get(contact.contact_name_id) || null,
  }));
});
