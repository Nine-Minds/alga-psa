'use server';

import { createTenantKnex, withTransaction } from '@alga-psa/db';
import type { Knex } from 'knex';
import type { IClient, IClientLocation, IContact } from '@alga-psa/types';
import type { ContactFilterStatus } from '@alga-psa/shared/ticketClients/types';
import { getAllClients as getAllClientsModel, getClientById as getClientByIdModel } from '@alga-psa/shared/ticketClients/clients';
import {
  getContactByContactNameId as getContactByContactNameIdModel,
  getContactsByClient as getContactsByClientModel,
} from '@alga-psa/shared/ticketClients/contacts';
import { getClientLocations as getClientLocationsModel } from '@alga-psa/shared/ticketClients/locations';
import { withAuth } from '@alga-psa/auth';

export const getAllClients = withAuth(async (_user, { tenant }, includeInactive: boolean = true): Promise<IClient[]> => {
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return getAllClientsModel(trx, tenant, includeInactive);
  });
});

export const getClientById = withAuth(async (_user, { tenant }, clientId: string): Promise<IClient | null> => {
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return getClientByIdModel(trx, tenant, clientId);
  });
});

export const getContactsByClient = withAuth(async (
  _user,
  { tenant },
  clientId: string,
  status: ContactFilterStatus = 'active',
  sortBy: 'full_name' | 'created_at' | 'email' | 'phone_number' = 'full_name',
  sortDirection: 'asc' | 'desc' = 'asc'
): Promise<IContact[]> => {
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return getContactsByClientModel(trx, tenant, clientId, status, sortBy, sortDirection);
  });
});

export const getContactByContactNameId = withAuth(async (_user, { tenant }, contactNameId: string): Promise<IContact | null> => {
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return getContactByContactNameIdModel(trx, tenant, contactNameId);
  });
});

export const getClientLocations = withAuth(async (_user, { tenant }, clientId: string): Promise<IClientLocation[]> => {
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return getClientLocationsModel(trx, tenant, clientId);
  });
});
