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

export async function getAllClients(includeInactive: boolean = true): Promise<IClient[]> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant configuration not found');
  }

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return getAllClientsModel(trx, tenant, includeInactive);
  });
}

export async function getClientById(clientId: string): Promise<IClient | null> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant configuration not found');
  }

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return getClientByIdModel(trx, tenant, clientId);
  });
}

export async function getContactsByClient(
  clientId: string,
  status: ContactFilterStatus = 'active',
  sortBy: 'full_name' | 'created_at' | 'email' | 'phone_number' = 'full_name',
  sortDirection: 'asc' | 'desc' = 'asc'
): Promise<IContact[]> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant configuration not found');
  }

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return getContactsByClientModel(trx, tenant, clientId, status, sortBy, sortDirection);
  });
}

export async function getContactByContactNameId(contactNameId: string): Promise<IContact | null> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant configuration not found');
  }

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return getContactByContactNameIdModel(trx, tenant, contactNameId);
  });
}

export async function getClientLocations(clientId: string): Promise<IClientLocation[]> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant configuration not found');
  }

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return getClientLocationsModel(trx, tenant, clientId);
  });
}

