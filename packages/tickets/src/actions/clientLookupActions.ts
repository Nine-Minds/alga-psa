'use server';

import { createTenantKnex, withTransaction } from '@alga-psa/db';
import type { Knex } from 'knex';
import type { IClient, IClientLocation, IContact } from '@alga-psa/types';
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
