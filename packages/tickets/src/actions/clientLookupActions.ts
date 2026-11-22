'use server';

import { createTenantKnex, withTransaction } from '@alga-psa/db';
import type { Knex } from 'knex';
import type { IClient, IClientLocation, IContact } from '@alga-psa/types';
import type { ContactFilterStatus } from '@alga-psa/shared/ticketClients/types';
import { getClientById as getClientByIdModel } from '@alga-psa/shared/ticketClients/clients';
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
import { tenantDb } from '@alga-psa/db';
import { createClientAccessDecider } from '@alga-psa/authorization/clientReadAuthorization';
import { isClientQuickViewFieldHidden, isClientLocationFieldHidden, isClientLocationResourceHidden } from '@alga-psa/authorization/clientFieldRedaction';
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
    const query = tenantDb(trx, tenant).table('clients')
      .select('client_id', 'client_name', 'client_type', 'is_inactive').orderBy('client_name');
    if (!includeInactive) query.where({ is_inactive: false });
    const clients = await query;
    const decide = await createClientAccessDecider(trx, tenant, user);
    const rows = await Promise.all(clients.map(async client => {
      const decision = await decide(client);
      if (!decision.allowed || isClientQuickViewFieldHidden(decision.redactedFields, 'client_id')
        || isClientQuickViewFieldHidden(decision.redactedFields, 'client_name')) return null;
      return Object.fromEntries(Object.entries(client).map(([field, value]) =>
        [field, isClientQuickViewFieldHidden(decision.redactedFields, field) ? null : value]));
    }));
    return rows.filter(row => row !== null) as unknown as IClient[];
  });
});

export const getClientById = withAuth(async (user, { tenant }, clientId: string): Promise<IClient | null> => {
  await assertInternalReadAccess(user, 'client');
  const { knex } = await createTenantKnex();

  const client = await withTransaction(knex, async (trx: Knex.Transaction) => {
    const decide = await createClientAccessDecider(trx, tenant, user);
    const decision = await decide({ client_id: clientId });
    if (!decision.allowed || isClientQuickViewFieldHidden(decision.redactedFields, 'client_id')
      || isClientQuickViewFieldHidden(decision.redactedFields, 'client_name')) return null;
    const row = await getClientByIdModel(trx, tenant, clientId);
    if (!row) return null;
    const withLogo = { ...row, logoUrl: await getClientLogoUrl(clientId, tenant) };
    return Object.fromEntries(Object.entries(withLogo).map(([field, value]) =>
      [field, isClientQuickViewFieldHidden(decision.redactedFields, field) ? null : value])) as unknown as IClient;
  });

  if (!client) {
    return null;
  }

  return client;
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
    const decide = await createClientAccessDecider(trx, tenant, user);
    const decision = await decide({ client_id: clientId });
    if (!decision.allowed) throw new Error('Permission denied: cannot read client locations');
    if (isClientLocationResourceHidden(decision.redactedFields)) return [];
    const locations = await getClientLocationsModel(trx, tenant, clientId);
    return locations.map(location => Object.fromEntries(Object.entries(location).map(([field, value]) =>
      [field, isClientLocationFieldHidden(decision.redactedFields, field) ? null : value])) as unknown as IClientLocation);
  });
});
