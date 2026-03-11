import type { Knex } from 'knex';
import type { IContact } from '@alga-psa/types';
import type { ContactFilterStatus } from './types';
import { ContactModel } from '../models/contactModel';

type ContactSortBy = 'full_name' | 'created_at' | 'email' | 'phone_number';

function getDefaultPhoneNumber(contact: Pick<IContact, 'default_phone_number' | 'phone_numbers'>): string {
  return contact.default_phone_number
    || contact.phone_numbers.find((phoneNumber) => phoneNumber.is_default)?.phone_number
    || '';
}

function sortContacts(
  contacts: IContact[],
  sortBy: ContactSortBy,
  sortDirection: 'asc' | 'desc'
): IContact[] {
  const directionMultiplier = sortDirection === 'asc' ? 1 : -1;

  return [...contacts].sort((left, right) => {
    const leftValue = sortBy === 'phone_number'
      ? getDefaultPhoneNumber(left)
      : String((left as Record<string, unknown>)[sortBy] ?? '');
    const rightValue = sortBy === 'phone_number'
      ? getDefaultPhoneNumber(right)
      : String((right as Record<string, unknown>)[sortBy] ?? '');

    const comparison = leftValue.localeCompare(rightValue, undefined, { sensitivity: 'base' });
    if (comparison !== 0) {
      return comparison * directionMultiplier;
    }

    return left.full_name.localeCompare(right.full_name, undefined, { sensitivity: 'base' });
  });
}

export async function getContactByContactNameId(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  contactNameId: string
): Promise<IContact | null> {
  const baseContact = await knexOrTrx('contacts')
    .select('contacts.*', 'clients.client_name')
    .leftJoin('clients', function joinClients(this: Knex.JoinClause) {
      this.on('contacts.client_id', 'clients.client_id').andOn('clients.tenant', 'contacts.tenant');
    })
    .where({
      'contacts.contact_name_id': contactNameId,
      'contacts.tenant': tenant,
    })
    .first();

  if (!baseContact) return null;

  const [contact] = await ContactModel.hydrateContactsWithPhoneNumbers([baseContact as any], tenant, knexOrTrx as Knex.Transaction);
  return { ...contact, avatarUrl: (contact as any).avatarUrl ?? null } as IContact;
}

export async function getContactsByClient(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  clientId: string,
  status: ContactFilterStatus = 'active',
  sortBy: ContactSortBy = 'full_name',
  sortDirection: 'asc' | 'desc' = 'asc'
): Promise<IContact[]> {
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
    .orderBy('contacts.full_name', 'asc');

  const contacts = await ContactModel.hydrateContactsWithPhoneNumbers((await query) as any[], tenant, knexOrTrx as Knex.Transaction) as IContact[];
  return sortContacts(contacts, sortBy, sortDirection)
    .map((contact) => ({ ...contact, avatarUrl: (contact as any).avatarUrl ?? null } as IContact));
}

export async function getAllActiveContacts(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  sortDirection: 'asc' | 'desc' = 'asc'
): Promise<IContact[]> {
  const contacts = await ContactModel.hydrateContactsWithPhoneNumbers((await knexOrTrx('contacts')
    .select('contacts.*', 'clients.client_name')
    .leftJoin('clients', function joinClients(this: Knex.JoinClause) {
      this.on('contacts.client_id', 'clients.client_id').andOn('clients.tenant', 'contacts.tenant');
    })
    .where('contacts.tenant', tenant)
    .andWhere('contacts.is_inactive', false)
    .orderBy('contacts.full_name', sortDirection)) as any[], tenant, knexOrTrx as Knex.Transaction) as IContact[];

  return contacts.map((c) => ({ ...c, avatarUrl: (c as any).avatarUrl ?? null } as IContact));
}
