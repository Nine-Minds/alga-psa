import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { IContact } from '@alga-psa/types';
import type { ContactFilterStatus } from './types';
import { ContactModel } from '../models/contactModel';
import { getContactLocationsForContacts } from '../models/contactLocation';

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

function tenantScopedTable(
  conn: Knex | Knex.Transaction,
  tenant: string,
  table: string,
): Knex.QueryBuilder<any, any> {
  return tenantDb(conn, tenant).table(table) as Knex.QueryBuilder<any, any>;
}

/**
 * Attaches `locations` and `primaryLocation` in one batched read, the same pass the display tags
 * take, so a picker page costs one extra query rather than one per row.
 */
async function withLocations<T extends { contact_name_id: string }>(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  contacts: T[],
): Promise<T[]> {
  if (contacts.length === 0) return contacts;
  const byContact = await getContactLocationsForContacts(
    knexOrTrx,
    tenant,
    contacts.map((contact) => contact.contact_name_id),
  );
  return contacts.map((contact) => {
    const locations = byContact.get(contact.contact_name_id) ?? [];
    const primary = locations.find((location) => location.is_primary)
      ?? (locations.length === 1 ? locations[0] : null);
    return {
      ...contact,
      locations,
      primaryLocation: primary
        ? { location_id: primary.location_id, location_name: primary.location_name }
        : null,
    };
  });
}

export async function getContactByContactNameId(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  contactNameId: string
): Promise<IContact | null> {
  const query = tenantScopedTable(knexOrTrx, tenant, 'contacts')
    .select('contacts.*', 'clients.client_name');
  tenantDb(knexOrTrx, tenant).tenantJoin(query, 'clients', 'contacts.client_id', 'clients.client_id', { type: 'left' });
  const baseContact = await query
    .where({
      'contacts.contact_name_id': contactNameId,
    })
    .first();

  if (!baseContact) return null;

  const [contact] = await ContactModel.hydrateContactsWithPhoneNumbers([baseContact as any], tenant, knexOrTrx as Knex.Transaction);
  const [withLocation] = await withLocations(knexOrTrx, tenant, [contact as any]);
  return { ...withLocation, avatarUrl: (contact as any).avatarUrl ?? null } as IContact;
}

export async function getContactsByClient(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  clientId: string,
  status: ContactFilterStatus = 'active',
  sortBy: ContactSortBy = 'full_name',
  sortDirection: 'asc' | 'desc' = 'asc'
): Promise<IContact[]> {
  const query = tenantScopedTable(knexOrTrx, tenant, 'contacts')
    .select('contacts.*', 'clients.client_name')
    .where('contacts.client_id', clientId)
    .modify((qb: Knex.QueryBuilder) => {
      if (status !== 'all') {
        qb.where('contacts.is_inactive', status === 'inactive');
      }
    })
    .orderBy('contacts.full_name', 'asc');
  tenantDb(knexOrTrx, tenant).tenantJoin(query, 'clients', 'contacts.client_id', 'clients.client_id', { type: 'left' });

  const hydrated = await ContactModel.hydrateContactsWithPhoneNumbers((await query) as any[], tenant, knexOrTrx as Knex.Transaction) as IContact[];
  const contacts = await withLocations(knexOrTrx, tenant, hydrated as Array<IContact & { contact_name_id: string }>);
  return sortContacts(contacts, sortBy, sortDirection)
    .map((contact) => ({ ...contact, avatarUrl: (contact as any).avatarUrl ?? null } as IContact));
}

export async function getAllActiveContacts(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  sortDirection: 'asc' | 'desc' = 'asc'
): Promise<IContact[]> {
  const query = tenantScopedTable(knexOrTrx, tenant, 'contacts')
    .select('contacts.*', 'clients.client_name')
    .andWhere('contacts.is_inactive', false)
    .orderBy('contacts.full_name', sortDirection);
  tenantDb(knexOrTrx, tenant).tenantJoin(query, 'clients', 'contacts.client_id', 'clients.client_id', { type: 'left' });
  const hydrated = await ContactModel.hydrateContactsWithPhoneNumbers((await query) as any[], tenant, knexOrTrx as Knex.Transaction) as IContact[];
  const contacts = await withLocations(knexOrTrx, tenant, hydrated as Array<IContact & { contact_name_id: string }>);

  return contacts.map((c) => ({ ...c, avatarUrl: (c as any).avatarUrl ?? null } as IContact));
}
