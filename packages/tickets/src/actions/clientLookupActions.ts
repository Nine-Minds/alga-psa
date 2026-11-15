'use server';

import { CLIENT_BILLING_PERMISSION, omitClientBillingColumns } from '@alga-psa/auth/lib/clientBillingProjection';
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
import {
  searchClientsForPicker as searchClientsForPickerModel,
  type SearchClientsForPickerParams,
  type TaggedSearchClientsForPickerResult,
} from '@alga-psa/shared/ticketClients/clientPicker';
import { attachDisplayTags } from '@alga-psa/tags/lib/displayTags';
import { getClientLocations as getClientLocationsModel } from '@alga-psa/shared/ticketClients/locations';
import {
  listClientBillingProfiles,
  type ClientBillingProfileRow,
} from '@alga-psa/shared/billingClients/billingProfiles';
import { withAuth, hasPermission, checkMultiplePermissions } from '@alga-psa/auth';
import type { IUserWithRoles } from '@alga-psa/types';
import { getClientLogoUrl } from '@alga-psa/formatting/avatarUtils';
import { createClientScopeContext, type ClientScopeContext } from '@alga-psa/authorization/clientScopeAuthorization';

// LEVERAGE: pattern client-scope-per-action — every action here (and the twins in @alga-psa/clients) opens one
// scope per call, narrows, and turns "out of scope" into its own not-found shape; a lookup layer that took the
// scope once and answered "not found" uniformly would absorb it.
function scopeFor(knex: Knex, tenant: string, user: IUserWithRoles): Promise<ClientScopeContext> {
  return createClientScopeContext(knex, tenant, user);
}

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

/**
 * `assertInternalReadAccess(user, 'client')` for an action that returns client rows: the read check and the
 * billing projection (clientBillingProjection) are answered from one load of the user's roles, so projecting
 * the rows costs the lookup no extra statement. Returns whether the billing columns may be shown.
 */
// LEVERAGE: pattern request-scoped-permissions — third hand-batched read+billing check (getAllClientsPaginated, getConsolidatedTicketData); a per-request permission set would make the projection free everywhere.
async function assertInternalClientRowAccess(user: IUserWithRoles): Promise<{ billingVisible: boolean }> {
  if (user.user_type !== 'internal') {
    throw new Error('Permission denied: client lookup actions are internal-only');
  }
  const [canRead, billing] = await checkMultiplePermissions(user, [
    { resource: 'client', action: 'read' },
    CLIENT_BILLING_PERMISSION,
  ]);
  if (!canRead?.granted) {
    throw new Error('Permission denied: cannot read client');
  }
  return { billingVisible: Boolean(billing?.granted) };
}

export const getAllClients = withAuth(async (user, { tenant }, includeInactive: boolean = true): Promise<IClient[]> => {
  const { billingVisible } = await assertInternalClientRowAccess(user);
  const { knex } = await createTenantKnex();

  // Resolved before the transaction opens; the predicate is applied inside the list query.
  const narrowing = await (await scopeFor(knex, tenant, user)).narrowing('client', 'clients');

  const clients = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return getAllClientsModel(trx, tenant, includeInactive, { narrowQuery: (query) => { narrowing.apply(query); } });
  });
  return billingVisible ? clients : clients.map(omitClientBillingColumns);
});

export const getClientById = withAuth(async (user, { tenant }, clientId: string): Promise<IClient | null> => {
  const { billingVisible } = await assertInternalClientRowAccess(user);
  const { knex } = await createTenantKnex();

  const narrowing = await (await scopeFor(knex, tenant, user)).narrowing('client', 'clients');
  const client = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return getClientByIdModel(trx, tenant, clientId, { narrowQuery: (query) => { narrowing.apply(query); } });
  });

  // Out of scope reads as not found, before the logo lookup.
  if (!client) {
    return null;
  }

  // Resolve the uploaded logo so the client drawer opened from the tickets list
  // shows the real logo (matching the table), not just initials.
  const logoUrl = await getClientLogoUrl(clientId, tenant);
  const withLogo = { ...client, logoUrl };
  return billingVisible ? withLogo : omitClientBillingColumns(withLogo);
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

  // One scope for the call: the client check and the contact rows share its probe, subject and rules.
  const scope = await scopeFor(knex, tenant, user);
  const contactNarrowing = await scope.narrowing('contact', 'contacts');

  // Same answer as getContactsByClient in @alga-psa/clients when the client is out of scope.
  if (!(await scope.permits('client', clientId))) {
    throw new Error('VALIDATION_ERROR: The specified client does not exist');
  }

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return getContactsByClientModel(trx, tenant, clientId, status, sortBy, sortDirection, {
      narrowQuery: (query) => { contactNarrowing.apply(query); },
    });
  });
});

export const getContactByContactNameId = withAuth(async (user, { tenant }, contactNameId: string): Promise<IContact | null> => {
  await assertInternalReadAccess(user, 'contact');
  const { knex } = await createTenantKnex();

  const narrowing = await (await scopeFor(knex, tenant, user)).narrowing('contact', 'contacts');

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return getContactByContactNameIdModel(trx, tenant, contactNameId, { narrowQuery: (query) => { narrowing.apply(query); } });
  });
});

export const getAllActiveContacts = withAuth(async (
  user,
  { tenant },
  sortDirection: 'asc' | 'desc' = 'asc'
): Promise<IContact[]> => {
  await assertInternalReadAccess(user, 'contact');
  const { knex } = await createTenantKnex();

  // A narrowed subject sees no contact without a client, nor one of a client out of scope.
  const narrowing = await (await scopeFor(knex, tenant, user)).narrowing('contact', 'contacts');

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return getAllActiveContactsModel(trx, tenant, sortDirection, { narrowQuery: (query) => { narrowing.apply(query); } });
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

  // Out of scope: no profiles. Checked first because the model backfills a default profile on read.
  if (!(await (await scopeFor(knex, tenant, user)).permits('client', clientId))) return [];

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return listClientBillingProfiles(trx, tenant, clientId);
  });
});

export const getClientLocations = withAuth(async (user, { tenant }, clientId: string): Promise<IClientLocation[]> => {
  await assertInternalReadAccess(user, 'client');
  const { knex } = await createTenantKnex();

  // Out of scope: no locations.
  if (!(await (await scopeFor(knex, tenant, user)).permits('client', clientId))) return [];

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

  // An out-of-scope contact reads like one that does not exist: no links, no effective location.
  if (!(await (await scopeFor(knex, tenant, user)).permits('contact', contactId))) {
    return { locationId: null, locations: [], workArrangement: null };
  }

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
  const narrowing = await (await scopeFor(knex, tenant, user)).narrowing('client', 'c');

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const db = tenantDb(trx, tenant);
    const query = db.table('client_locations as loc').where('loc.is_active', true);
    db.tenantJoin(query, 'clients as c', 'c.client_id', 'loc.client_id', { type: 'left' });
    // The scope predicate reads the joined client's id, which equals loc.client_id; a location whose client
    // is out of scope (or has no client row) fails it, so the left join cannot let one through.
    narrowing.apply(query);
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

/**
 * Paged/searchable client lookup for the ticket surfaces' async client picker.
 *
 * Tickets-local twin of `searchClientsForPicker` in @alga-psa/clients (which
 * tickets must not import: nx cycle). Both delegate to the same shared model;
 * both require an internal user holding client:read, and both attach the chip
 * tags the viewer's display rules allow.
 */
export const searchClientsForPicker = withAuth(async (
  user,
  { tenant },
  params: SearchClientsForPickerParams = {}
): Promise<TaggedSearchClientsForPickerResult> => {
  await assertInternalReadAccess(user, 'client');
  const { knex } = await createTenantKnex();

  // Resolved before the picker opens its own transaction; the predicate is applied inside its query.
  const narrowing = await (await scopeFor(knex, tenant, user)).narrowing('client', 'c');
  const { clients, total } = await searchClientsForPickerModel(knex, tenant, user, params, {
    narrowQuery: (query) => { narrowing.apply(query); },
  });
  const withTags = await attachDisplayTags(knex, tenant, user, 'client', clients, (c) => c.client_id);

  return { clients: withTags, total };
});
