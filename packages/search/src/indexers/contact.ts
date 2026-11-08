import type { Knex } from 'knex';

import { createTenantScopedIndexerQuery, tenantJoinIndexerTable } from '../tenantScopedIndexerQuery';
import { truncateForIndex } from '../normalize';
import type { EntityIndexer, SearchDoc } from '@alga-psa/types';

interface ContactSearchRow {
  contact_name_id: string;
  full_name: string;
  email: string | null;
  role: string | null;
  notes: string | null;
  client_name: string | null;
  work_arrangement: string | null;
  created_at?: Date | string | null;
  updated_at?: Date | string | null;
}

interface ContactPhoneRow {
  contact_name_id: string;
  phone_number: string | null;
}

interface ContactLocationRow {
  contact_name_id: string;
  is_primary: boolean;
  location_name: string | null;
  city: string | null;
}

interface ContactLocationIndexData {
  /** Primary location name, which joins the subtitle after the client name. */
  primaryName?: string;
  /** Every linked location name and city, so "warehouse" or "Leeds" finds the people there. */
  tokens: string[];
}

function compactJoin(values: Array<string | null | undefined>): string | undefined {
  const joined = values.map((value) => value?.trim()).filter(Boolean).join(' | ');
  return joined || undefined;
}

function toSourceUpdatedAt(row: ContactSearchRow): Date {
  const value = row.updated_at ?? row.created_at;
  return value ? new Date(value) : new Date();
}

/** Both the formatted and digits-only form, so either spelling tokenizes. */
function phoneTokens(phoneNumber: string | null | undefined): string[] {
  const formatted = phoneNumber?.trim();
  if (!formatted) {
    return [];
  }
  const digits = formatted.replace(/\D+/g, '');
  return digits && digits !== formatted ? [formatted, digits] : [formatted];
}

function resolveBody(
  row: ContactSearchRow,
  phoneNumbers: string[],
  locations: ContactLocationIndexData,
): string | undefined {
  const fragments = [
    ...phoneNumbers.flatMap((phoneNumber) => phoneTokens(phoneNumber)),
    ...locations.tokens,
    // So the "Remote / who works from home" question is answerable from the search box.
    row.work_arrangement === 'remote' ? 'Remote' : undefined,
    row.notes?.trim(),
  ].filter(Boolean) as string[];
  const joined = fragments.join(' ').trim();
  return joined ? truncateForIndex(joined) : undefined;
}

function toSearchDoc(
  tenant: string,
  row: ContactSearchRow,
  phoneNumbers: string[],
  locations: ContactLocationIndexData = { tokens: [] },
): SearchDoc {
  return {
    tenant,
    objectType: 'contact',
    objectId: row.contact_name_id,
    title: row.full_name,
    subtitle: compactJoin([row.email, row.role, row.client_name, locations.primaryName]),
    body: resolveBody(row, phoneNumbers, locations),
    url: `/msp/contacts/${row.contact_name_id}`,
    acl: {
      requiredPermission: 'contact:read',
    },
    sourceUpdatedAt: toSourceUpdatedAt(row),
  };
}

function baseContactQuery(knex: Knex, tenant: string) {
  const query = createTenantScopedIndexerQuery<ContactSearchRow>(knex, 'contacts as ct', 'ct', tenant);
  tenantJoinIndexerTable(knex, tenant, query, 'clients as cl', 'cl.client_id', 'ct.client_id', { type: 'left' });

  return query.select(
    'ct.contact_name_id',
    'ct.full_name',
    'ct.email',
    'ct.role',
    'ct.notes',
    'ct.work_arrangement',
    'ct.created_at',
    'ct.updated_at',
    'cl.client_name',
  );
}

/**
 * Phones are a 1:N child table, so they are loaded separately — joining them
 * into the batch query would multiply rows and break the cursor/limit paging.
 */
async function loadPhoneNumbers(
  knex: Knex,
  tenant: string,
  contactIds: string[],
): Promise<Map<string, string[]>> {
  const byContact = new Map<string, string[]>();
  if (contactIds.length === 0) {
    return byContact;
  }

  const rows = await createTenantScopedIndexerQuery<ContactPhoneRow>(
    knex,
    'contact_phone_numbers',
    'contact_phone_numbers',
    tenant,
  )
    .select('contact_name_id', 'phone_number')
    .whereIn('contact_name_id', contactIds)
    .orderBy('display_order', 'asc');

  for (const row of rows) {
    if (!row.phone_number) {
      continue;
    }
    const existing = byContact.get(row.contact_name_id) ?? [];
    existing.push(row.phone_number);
    byContact.set(row.contact_name_id, existing);
  }

  return byContact;
}

/**
 * Location links are a 1:N child table, loaded per batch exactly like the phone numbers: joining
 * them into the batch query would multiply rows and break the cursor paging.
 */
async function loadLocations(
  knex: Knex,
  tenant: string,
  contactIds: string[],
): Promise<Map<string, ContactLocationIndexData>> {
  const byContact = new Map<string, ContactLocationIndexData>();
  if (contactIds.length === 0) {
    return byContact;
  }

  const query = createTenantScopedIndexerQuery<ContactLocationRow>(
    knex,
    'contact_locations as cloc',
    'cloc',
    tenant,
  );
  tenantJoinIndexerTable(knex, tenant, query, 'client_locations as loc', 'loc.location_id', 'cloc.location_id');

  const rows = await query
    .select('cloc.contact_name_id', 'cloc.is_primary', 'loc.location_name', 'loc.city')
    .whereIn('cloc.contact_name_id', contactIds)
    .orderBy('cloc.is_primary', 'desc');

  for (const row of rows) {
    const existing = byContact.get(row.contact_name_id) ?? { tokens: [] };
    const name = row.location_name?.trim();
    const city = row.city?.trim();
    if (row.is_primary && name && !existing.primaryName) {
      existing.primaryName = name;
    }
    if (name) existing.tokens.push(name);
    if (city) existing.tokens.push(city);
    byContact.set(row.contact_name_id, existing);
  }

  return byContact;
}

export const contactIndexer: EntityIndexer = {
  objectType: 'contact',
  // The two location events are here because a contact's indexed subtitle and body carry its
  // locations' names and cities; the subscriber turns them into a re-index of the linked contacts.
  sourceEvents: [
    'CONTACT_CREATED', 'CONTACT_UPDATED', 'CONTACT_ARCHIVED', 'CONTACT_DELETED',
    'CLIENT_LOCATION_UPDATED', 'CLIENT_LOCATION_DEACTIVATED',
  ],

  async loadOne(knex: Knex, tenant: string, id: string): Promise<SearchDoc | null> {
    const row = await baseContactQuery(knex, tenant)
      .andWhere('ct.contact_name_id', id)
      .first();

    if (!row) {
      return null;
    }

    const phoneNumbers = await loadPhoneNumbers(knex, tenant, [row.contact_name_id]);
    const locations = await loadLocations(knex, tenant, [row.contact_name_id]);
    return toSearchDoc(
      tenant,
      row,
      phoneNumbers.get(row.contact_name_id) ?? [],
      locations.get(row.contact_name_id) ?? { tokens: [] },
    );
  },

  async loadBatch(
    knex: Knex,
    tenant: string,
    cursor: string | null | undefined,
    limit: number,
  ): Promise<SearchDoc[]> {
    const query = baseContactQuery(knex, tenant)
      .orderBy('ct.contact_name_id', 'asc')
      .limit(limit);

    if (cursor) {
      query.andWhere('ct.contact_name_id', '>', cursor);
    }

    const rows = await query;
    const contactIds = rows.map((row) => row.contact_name_id);
    const phoneNumbers = await loadPhoneNumbers(knex, tenant, contactIds);
    const locations = await loadLocations(knex, tenant, contactIds);
    return rows.map((row) => toSearchDoc(
      tenant,
      row,
      phoneNumbers.get(row.contact_name_id) ?? [],
      locations.get(row.contact_name_id) ?? { tokens: [] },
    ));
  },
};
