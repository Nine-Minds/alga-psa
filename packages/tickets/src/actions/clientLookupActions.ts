'use server';

import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import type { Knex } from 'knex';
import type { IClient, IClientLocation, IContact, IContactLocation } from '@alga-psa/types';
import {
  getContactLocations,
  resolveContactLocationId,
} from '@alga-psa/shared/models/contactLocation';
import type { ContactFilterStatus } from '@alga-psa/shared/ticketClients/types';
import { getAllClients as getAllClientsModel, getClientById as getClientByIdModel } from '@alga-psa/shared/ticketClients/clients';
import {
  getContactByContactNameId as getContactByContactNameIdModel,
  getAllActiveContacts as getAllActiveContactsModel,
  getContactsByClient as getContactsByClientModel,
} from '@alga-psa/shared/ticketClients/contacts';
import { getClientLocations as getClientLocationsModel } from '@alga-psa/shared/ticketClients/locations';
import {
  listClientBillingProfiles,
  type ClientBillingProfileRow,
} from '@alga-psa/shared/billingClients/billingProfiles';
import { withAuth, hasPermission } from '@alga-psa/auth';
import type { IUserWithRoles } from '@alga-psa/types';
import { getClientLogoUrl } from '@alga-psa/formatting/avatarUtils';

// MSP-only lookups: these actions back internal ticket UIs and expose
// tenant-wide client/contact data, so client-portal callers (user_type
// 'client') are rejected and the caller must hold the matching read
// permission.
async function assertInternalReadAccess(user: IUserWithRoles, resource: 'client' | 'contact'): Promise<void> {
  if (user.user_type !== 'internal') {
    throw new Error('Permission denied: client lookup actions are internal-only');
  }
  if (!await hasPermission(user, resource, 'read')) {
    throw new Error(`Permission denied: cannot read ${resource}`);
  }
}

export const getAllClients = withAuth(async (user, { tenant }, includeInactive: boolean = true): Promise<IClient[]> => {
  await assertInternalReadAccess(user, 'client');
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return getAllClientsModel(trx, tenant, includeInactive);
  });
});

export const getClientById = withAuth(async (user, { tenant }, clientId: string): Promise<IClient | null> => {
  await assertInternalReadAccess(user, 'client');
  const { knex } = await createTenantKnex();

  const client = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return getClientByIdModel(trx, tenant, clientId);
  });

  if (!client) {
    return null;
  }

  // Resolve the uploaded logo so the client drawer opened from the tickets list
  // shows the real logo (matching the table), not just initials.
  const logoUrl = await getClientLogoUrl(clientId, tenant);
  return { ...client, logoUrl };
});

export const getContactsByClient = withAuth(async (
  user,
  { tenant },
  clientId: string,
  status: ContactFilterStatus = 'active',
  sortBy: 'full_name' | 'created_at' | 'email' | 'phone_number' = 'full_name',
  sortDirection: 'asc' | 'desc' = 'asc'
): Promise<IContact[]> => {
  await assertInternalReadAccess(user, 'contact');
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return getContactsByClientModel(trx, tenant, clientId, status, sortBy, sortDirection);
  });
});

export const getContactByContactNameId = withAuth(async (user, { tenant }, contactNameId: string): Promise<IContact | null> => {
  await assertInternalReadAccess(user, 'contact');
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return getContactByContactNameIdModel(trx, tenant, contactNameId);
  });
});

export const getAllActiveContacts = withAuth(async (
  user,
  { tenant },
  sortDirection: 'asc' | 'desc' = 'asc'
): Promise<IContact[]> => {
  await assertInternalReadAccess(user, 'contact');
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return getAllActiveContactsModel(trx, tenant, sortDirection);
  });
});

/**
 * The client's billing profiles, for the ticket profile picker (F047).
 *
 * A thin wrapper over the shared model rather than a re-implementation: the
 * D6 invisibility rule reads `profiles.length > 1`, and two implementations of
 * that list would eventually disagree about whether a client is segmented.
 */
export const getClientBillingProfiles = withAuth(async (
  user,
  { tenant },
  clientId: string,
): Promise<ClientBillingProfileRow[]> => {
  await assertInternalReadAccess(user, 'client');
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return listClientBillingProfiles(trx, tenant, clientId);
  });
});

export const getClientLocations = withAuth(async (user, { tenant }, clientId: string): Promise<IClientLocation[]> => {
  await assertInternalReadAccess(user, 'client');
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return getClientLocationsModel(trx, tenant, clientId);
  });
});

export interface ContactEffectiveLocation {
  /** What TicketModel.createTicket would fill in when nobody picks a location. */
  locationId: string | null;
  /** The contact's own links, so the form can mark and group them. */
  locations: IContactLocation[];
  workArrangement: string | null;
}

/**
 * The same effective-location rule the model applies, read ahead of the save so the ticket forms
 * can show the operator what they are about to get and let them override it. One source of truth:
 * the form calls this, the model calls the same function again on write.
 */
export const getContactEffectiveLocation = withAuth(async (
  user,
  { tenant },
  contactId: string,
): Promise<ContactEffectiveLocation> => {
  await assertInternalReadAccess(user, 'contact');
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const contact = await tenantDb(trx, tenant).table('contacts')
      .where({ contact_name_id: contactId })
      .first<{ work_arrangement: string | null }>(['work_arrangement']);

    return {
      locationId: await resolveContactLocationId(trx, tenant, contactId),
      locations: await getContactLocations(trx, tenant, contactId),
      workArrangement: contact?.work_arrangement ?? null,
    };
  });
});

export interface TicketFilterLocationOption {
  location_id: string;
  location_name: string;
  client_id: string;
  client_name: string | null;
}

/**
 * The options behind the two Location `where` filters. Narrowed to one client when the list is
 * filtered to it (then the client name is left off, because every row would carry the same one);
 * otherwise every active tenant location, labelled by client so two "Head office" rows are
 * tellable apart.
 */
export const listTicketFilterLocations = withAuth(async (
  user,
  { tenant },
  clientId?: string | null,
): Promise<TicketFilterLocationOption[]> => {
  await assertInternalReadAccess(user, 'client');
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const db = tenantDb(trx, tenant);
    const query = db.table('client_locations as loc').where('loc.is_active', true);
    db.tenantJoin(query, 'clients as c', 'c.client_id', 'loc.client_id', { type: 'left' });
    if (clientId) query.where('loc.client_id', clientId);

    const rows = await query
      .select('loc.location_id', 'loc.location_name', 'loc.address_line1', 'loc.client_id', 'c.client_name')
      .orderBy([{ column: 'c.client_name', order: 'asc' }, { column: 'loc.location_name', order: 'asc' }]) as
      Array<{ location_id: string; location_name: string | null; address_line1: string | null; client_id: string; client_name: string | null }>;

    return rows.map((row) => ({
      location_id: row.location_id,
      location_name: row.location_name?.trim() || row.address_line1?.trim() || row.location_id,
      client_id: row.client_id,
      client_name: clientId ? null : row.client_name,
    }));
  });
});
