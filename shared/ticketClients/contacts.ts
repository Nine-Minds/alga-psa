import type { Knex } from 'knex';
import type { IContact } from '@alga-psa/types';
import type { ContactFilterStatus } from './types';

export async function getContactByContactNameId(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  contactNameId: string
): Promise<IContact | null> {
  const contact = await knexOrTrx('contacts')
    .select('contacts.*', 'clients.client_name')
    .leftJoin('clients', function joinClients(this: Knex.JoinClause) {
      this.on('contacts.client_id', 'clients.client_id').andOn('clients.tenant', 'contacts.tenant');
    })
    .where({
      'contacts.contact_name_id': contactNameId,
      'contacts.tenant': tenant,
    })
    .first();

  if (!contact) return null;
  return { ...contact, avatarUrl: (contact as any).avatarUrl ?? null } as IContact;
}

export async function getContactsByClient(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  clientId: string,
  status: ContactFilterStatus = 'active',
  sortBy: 'full_name' | 'created_at' | 'email' | 'phone_number' = 'full_name',
  sortDirection: 'asc' | 'desc' = 'asc'
): Promise<IContact[]> {
  const sortColumnMap: Record<typeof sortBy, string> = {
    full_name: 'contacts.full_name',
    created_at: 'contacts.created_at',
    email: 'contacts.email',
    phone_number: 'contacts.phone_number',
  };

  const query = knexOrTrx('contacts')
    .select('contacts.*', 'clients.client_name')
    .leftJoin('clients', function joinClients(this: Knex.JoinClause) {
      this.on('contacts.client_id', 'clients.client_id').andOn('clients.tenant', 'contacts.tenant');
    })
    .where('contacts.client_id', clientId)
    .andWhere('contacts.tenant', tenant)
    .modify((qb: Knex.QueryBuilder) => {
      if (status !== 'all') {
        qb.where('contacts.is_inactive', status === 'inactive');
      }
    })
    .orderBy(sortColumnMap[sortBy], sortDirection);

  const contacts = (await query) as IContact[];
  return contacts.map((c) => ({ ...c, avatarUrl: (c as any).avatarUrl ?? null } as IContact));
}

