import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { IContactLocation } from '../interfaces/contact.interfaces';

/**
 * Where a ticket for this person should land when nothing more specific was asked for.
 *
 * Precedence: a remote worker gets no location at all (never the client's head office), then the
 * primary link, then the only link, then the client's default active location, then nothing. Only
 * active locations take part: a deactivated site is not somewhere to send an engineer.
 *
 * This is the single rule behind MSP quick add, ticket detail, inbound email, the client portal,
 * REST v1 and mobile — `TicketModel.createTicket` calls it whenever `location_id` is `undefined`.
 * `null` from a caller means "explicitly none" and never reaches here.
 */
export async function resolveContactLocationId(
  trx: Knex | Knex.Transaction,
  tenant: string,
  contactId: string,
): Promise<string | null> {
  const db = tenantDb(trx, tenant);
  const contact = await db.table('contacts')
    .where({ contact_name_id: contactId })
    .first<{ client_id: string | null; work_arrangement: string | null }>(['client_id', 'work_arrangement']);

  if (!contact) return null;
  if (contact.work_arrangement === 'remote') return null;

  const linkQuery = db.table('contact_locations as cl')
    .where('cl.contact_name_id', contactId);
  db.tenantJoin(linkQuery, 'client_locations as loc', 'loc.location_id', 'cl.location_id');
  const links = await linkQuery
    .where('loc.is_active', true)
    .select('cl.location_id', 'cl.is_primary')
    .orderBy([{ column: 'cl.is_primary', order: 'desc' }, { column: 'loc.location_name', order: 'asc' }]) as
    Array<{ location_id: string; is_primary: boolean }>;

  const primary = links.find((link) => link.is_primary);
  if (primary) return primary.location_id;
  if (links.length === 1) return links[0].location_id;

  // Several active links and none primary (only reachable by a direct write — the editor and
  // replaceContactLocations always leave a primary): nothing here can choose between them, so fall
  // through to the client default rather than pick one at random.
  if (!contact.client_id) return null;
  const fallback = await db.table('client_locations')
    .where({ client_id: contact.client_id, is_default: true, is_active: true })
    .first<{ location_id: string }>(['location_id']);

  return fallback?.location_id ?? null;
}

/** The `client_locations` columns a link carries through to the UI and the REST response. */
export const CONTACT_LOCATION_COLUMNS = [
  'location_name',
  'address_line1',
  'address_line2',
  'address_line3',
  'city',
  'state_province',
  'postal_code',
  'country_code',
  'country_name',
  'is_active',
] as const;

export type ContactLocationRow = {
  contact_name_id: string;
  location_id: string;
  is_primary: boolean;
  location_name: string | null;
  address_line1: string | null;
  address_line2: string | null;
  address_line3: string | null;
  city: string | null;
  state_province: string | null;
  postal_code: string | null;
  country_code: string | null;
  country_name: string | null;
  is_active: boolean | null;
};

export function toContactLocation(row: ContactLocationRow): IContactLocation {
  return {
    location_id: row.location_id,
    location_name: row.location_name ?? null,
    is_primary: Boolean(row.is_primary),
    is_active: row.is_active !== false,
    address_line1: row.address_line1 ?? null,
    address_line2: row.address_line2 ?? null,
    address_line3: row.address_line3 ?? null,
    city: row.city ?? null,
    state_province: row.state_province ?? null,
    postal_code: row.postal_code ?? null,
    country_code: row.country_code ?? null,
    country_name: row.country_name ?? null,
  };
}

/**
 * One batched read for a page of contacts: joined on tenant on both sides, primary link first then
 * by name so callers can take `[0]` as the primary without re-sorting.
 */
export async function getContactLocationsForContacts(
  db: Knex | Knex.Transaction,
  tenant: string,
  contactIds: readonly string[],
): Promise<Map<string, IContactLocation[]>> {
  const byContact = new Map<string, IContactLocation[]>();
  const ids = [...new Set(contactIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return byContact;

  const scoped = tenantDb(db, tenant);
  const query = scoped.table('contact_locations as cl')
    .whereIn('cl.contact_name_id', ids);
  scoped.tenantJoin(query, 'client_locations as loc', 'loc.location_id', 'cl.location_id');

  const rows = await query
    .select(
      'cl.contact_name_id',
      'cl.location_id',
      'cl.is_primary',
      ...CONTACT_LOCATION_COLUMNS.map((column) => `loc.${column}`),
    )
    .orderBy([
      { column: 'cl.contact_name_id', order: 'asc' },
      { column: 'cl.is_primary', order: 'desc' },
      { column: 'loc.location_name', order: 'asc' },
    ]) as ContactLocationRow[];

  for (const row of rows) {
    const existing = byContact.get(row.contact_name_id) ?? [];
    existing.push(toContactLocation(row));
    byContact.set(row.contact_name_id, existing);
  }
  return byContact;
}

export async function getContactLocations(
  db: Knex | Knex.Transaction,
  tenant: string,
  contactId: string,
): Promise<IContactLocation[]> {
  const byContact = await getContactLocationsForContacts(db, tenant, [contactId]);
  return byContact.get(contactId) ?? [];
}

/** Backs the "this removes N location links" confirmation before a client change. */
export async function getContactLocationCount(
  db: Knex | Knex.Transaction,
  tenant: string,
  contactId: string,
): Promise<number> {
  const row = await tenantDb(db, tenant).table('contact_locations')
    .where({ contact_name_id: contactId })
    .count<{ count: string }>('location_id as count')
    .first();
  return Number(row?.count ?? 0);
}

/** How many contacts are linked to each of the given locations (0 is omitted). */
export async function getContactCountsByLocation(
  db: Knex | Knex.Transaction,
  tenant: string,
  locationIds: readonly string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const ids = [...new Set(locationIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return counts;

  const rows = await tenantDb(db, tenant).table('contact_locations')
    .whereIn('location_id', ids)
    .groupBy('location_id')
    .select('location_id')
    .count('contact_name_id as count') as Array<{ location_id: string; count: string }>;

  for (const row of rows) counts.set(row.location_id, Number(row.count));
  return counts;
}

/** The contacts linked to a location, for the client Locations card. */
export async function getContactsAtLocation(
  db: Knex | Knex.Transaction,
  tenant: string,
  locationId: string,
): Promise<Array<{ contact_name_id: string; full_name: string; is_primary: boolean }>> {
  const scoped = tenantDb(db, tenant);
  const query = scoped.table('contact_locations as cl')
    .where('cl.location_id', locationId);
  scoped.tenantJoin(query, 'contacts as c', 'c.contact_name_id', 'cl.contact_name_id');

  return await query
    .select('c.contact_name_id', 'c.full_name', 'cl.is_primary')
    .orderBy('c.full_name', 'asc') as Array<{ contact_name_id: string; full_name: string; is_primary: boolean }>;
}
