'use server'

import { tenantDb, withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { createTenantKnex } from '@alga-psa/db';
import type { IClientTaxRateAssociation } from '@alga-psa/types';
import { getClientDefaultTaxRegionCode as getClientDefaultTaxRegionCodeShared } from '@alga-psa/shared/billingClients';
import { withAuth } from '@alga-psa/auth';
import { assertMspPermission } from '../lib/authHelpers';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

type ClientTaxRateActionError = ActionMessageError | ActionPermissionError;

function clientTaxRateActionErrorFrom(error: unknown): ClientTaxRateActionError | null {
  if (error instanceof Error) {
    if (error.message.includes('Permission denied')) {
      return permissionError(error.message);
    }
    if (/unauthorized|not authenticated|must sign in/i.test(error.message)) {
      return permissionError('You must be signed in to update client tax rates.');
    }
    if (error.message === 'A default tax rate already exists for this client. Only one default rate is allowed.') {
      return actionError(error.message);
    }
  }

  const dbError = error as { code?: string; column?: string };
  if (dbError?.code === '22P02') {
    return actionError('The selected client or tax rate is invalid. Please refresh and try again.');
  }
  if (dbError?.code === '23502') {
    return actionError(`Missing required client tax-rate field${dbError.column ? `: ${dbError.column}` : ''}.`);
  }
  if (dbError?.code === '23503') {
    return actionError('The selected client or tax rate no longer exists. Please refresh and try again.');
  }
  if (dbError?.code === '23505') {
    return actionError('This tax rate is already associated with the client.');
  }

  return null;
}

const assertCanReadClientTaxRates = (user: any) =>
  assertMspPermission(
    user,
    'client',
    'read',
    'Permission denied: Cannot read client tax rates'
  );

const assertCanUpdateClientTaxRates = (user: any) =>
  assertMspPermission(
    user,
    'client',
    'update',
    'Permission denied: Cannot update client tax rates'
  );

// Combine association data with rate details
// Removed 'name' from Pick as it doesn't exist on the tax_rates table
export type ClientTaxRateDetails = IClientTaxRateAssociation & {
  tax_percentage: number;
  tax_type: 'VAT' | 'GST' | 'Sales Tax';
  country_code: string;
};

export const getClientTaxRates = withAuth(async (
  user,
  { tenant },
  clientId: string
): Promise<ClientTaxRateDetails[] | ClientTaxRateActionError> => {
  try {
    await assertCanReadClientTaxRates(user);
  } catch (error) {
    const expected = clientTaxRateActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }

  try {
    const { knex } = await createTenantKnex();
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const db = tenantDb(trx, tenant);
      const query = db.table<ClientTaxRateDetails>('client_tax_rates');
      db.tenantJoin(query, 'tax_rates', 'client_tax_rates.tax_rate_id', 'tax_rates.tax_rate_id');

      return await query
        .where('client_tax_rates.client_id', clientId)
        .select(
          'client_tax_rates.*',
          'tax_rates.tax_percentage',
         // 'tax_rates.name', // Removed as 'name' column does not exist on tax_rates table
          'tax_rates.tax_type',
          'tax_rates.country_code'
          // Removed region_code and description as they are not in ITaxRate base definition
          // Add them back if they are needed and present in ITaxRate
        );
    });
  } catch (error) {
    const expected = clientTaxRateActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

// Phase 1: Only allow adding a single default rate per client.
// Handles inserting a new default OR updating an existing non-default rate to become the default.
export const addClientTaxRate = withAuth(async (
  user,
  { tenant },
  clientTaxRateData: Pick<IClientTaxRateAssociation, 'client_id' | 'tax_rate_id'>
): Promise<IClientTaxRateAssociation | ClientTaxRateActionError> => {
  try {
    await assertCanUpdateClientTaxRates(user);
  } catch (error) {
    const expected = clientTaxRateActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }

  const { knex } = await createTenantKnex();
  const { client_id, tax_rate_id } = clientTaxRateData; // Destructure for clarity

  try {
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const db = tenantDb(trx, tenant);

    // 1. Phase 1 Constraint: Check if a default rate already exists
      const existingDefault = await db.table<IClientTaxRateAssociation>('client_tax_rates')
        .where({
          client_id: client_id,
          is_default: true
        })
        // Exclude the rate we are trying to set as default, in case it already exists but is not default
        .andWhereNot('tax_rate_id', tax_rate_id)
        .first();

      if (existingDefault) {
        // If a *different* rate is already default, prevent adding another one in Phase 1
        throw new Error('A default tax rate already exists for this client. Only one default rate is allowed.');
      }

    // 2. Check if the specific association already exists (even if not default)
      let association = await db.table<IClientTaxRateAssociation>('client_tax_rates')
        .where({
          client_id: client_id,
          tax_rate_id: tax_rate_id,
        })
        .first();

      if (association) {
      // 3a. If it exists, update it to be the default
        if (association.is_default) {
        // If it's already the default, just return it (no change needed)
          return association;
        }
        const [updatedAssociation] = await db.table<IClientTaxRateAssociation>('client_tax_rates')
          .where('client_tax_rates_id', association.client_tax_rates_id)
          .update({
            is_default: true,
            location_id: null, // Ensure location_id is null for default in Phase 1
            updated_at: knex.fn.now()
          })
          .returning('*');
        association = updatedAssociation;
      } else {
      // 3b. If it doesn't exist, insert a new record as the default
      // Corrected Omit type to use plural 'rates' id
        const dataToInsert: Omit<IClientTaxRateAssociation, 'client_tax_rates_id' | 'created_at' | 'updated_at'> = {
          client_id: client_id,
          tax_rate_id: tax_rate_id,
          tenant: tenant!,
          is_default: true,
          location_id: null // Ensure location_id is null for default in Phase 1
        };
        const [createdAssociation] = await db.table<IClientTaxRateAssociation>('client_tax_rates')
          .insert(dataToInsert)
          .returning('*');
        association = createdAssociation;
      }

      if (!association) {
        throw new Error('Default client tax-rate association write completed without returning a record.');
      }

      return association;
    });
  } catch (error) {
    const expected = clientTaxRateActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

export const removeClientTaxRate = withAuth(async (
  user,
  { tenant },
  clientId: string,
  taxRateId: string
): Promise<{ success: true } | ClientTaxRateActionError> => {
  try {
    await assertCanUpdateClientTaxRates(user);
  } catch (error) {
    const expected = clientTaxRateActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }

  try {
    const { knex } = await createTenantKnex();
    const deletedCount = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await tenantDb(trx, tenant).table<IClientTaxRateAssociation>('client_tax_rates')
        .where({
          client_id: clientId,
          tax_rate_id: taxRateId,
        })
        .del();
    });

    if (deletedCount === 0) {
      return actionError('Client tax rate association not found.');
    }

    return { success: true };
  } catch (error) {
    const expected = clientTaxRateActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

// Phase 1: Update the default tax rate for a client
export const updateDefaultClientTaxRate = withAuth(async (
  user,
  { tenant },
  clientId: string,
  newTaxRateId: string
): Promise<IClientTaxRateAssociation | ClientTaxRateActionError> => {
  try {
    await assertCanUpdateClientTaxRates(user);
  } catch (error) {
    const expected = clientTaxRateActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }

  const { knex } = await createTenantKnex();

  try {
    // Validate that the newTaxRateId exists for this tenant (optional but good practice)
    const newRateExists = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await tenantDb(trx, tenant).table('tax_rates')
        .where({ tax_rate_id: newTaxRateId })
        .first();
    });
    if (!newRateExists) {
      return actionError(`Tax rate with ID ${newTaxRateId} not found.`);
    }

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const db = tenantDb(trx, tenant);

    // 1. Find the current default rate ID (if one exists)
    const currentDefaultResult = await db.table<IClientTaxRateAssociation>('client_tax_rates')
      .select('client_tax_rates_id', 'tax_rate_id') // Corrected column name (plural rates)
      .where({
        client_id: clientId,
        is_default: true,
      })
      .first();

    const currentDefaultRatesId = currentDefaultResult?.client_tax_rates_id; // Corrected variable name
    const currentDefaultTaxRateId = currentDefaultResult?.tax_rate_id;

    if (currentDefaultTaxRateId && currentDefaultTaxRateId === newTaxRateId) {
      // If the selected rate is already the default, fetch and return the full record
      console.log('Selected rate is already the default. No change needed.');
      const fullCurrentDefault = await db.table<IClientTaxRateAssociation>('client_tax_rates').where({ client_tax_rates_id: currentDefaultRatesId }).first(); // Corrected column name
      if (!fullCurrentDefault) {
        throw new Error('Current default client tax-rate association could not be reloaded.');
      }
      return fullCurrentDefault;
    }

    // 2. Unset the current default if it exists
    if (currentDefaultRatesId) { // Corrected variable name
      await db.table<IClientTaxRateAssociation>('client_tax_rates')
        .where('client_tax_rates_id', currentDefaultRatesId) // Corrected column name
        .update({ is_default: false });
    }

    // 2. Find or create the association for the new rate
    let newDefaultAssociation = await db.table<IClientTaxRateAssociation>('client_tax_rates')
      .where({
        client_id: clientId,
        tax_rate_id: newTaxRateId,
      })
      .first();

    if (newDefaultAssociation) {
      // If association exists, update it to be the default
      const [updatedAssociation] = await db.table<IClientTaxRateAssociation>('client_tax_rates')
        .where('client_tax_rates_id', newDefaultAssociation.client_tax_rates_id) // Corrected column name
        .update({
          is_default: true,
          location_id: null, // Ensure location_id is null for default in Phase 1
          updated_at: knex.fn.now() // Explicitly update timestamp
        })
        .returning('*');
      newDefaultAssociation = updatedAssociation;
    } else {
      // If association doesn't exist, create it as the default
      // Corrected Omit type to use plural 'rates' id
      const dataToInsert: Omit<IClientTaxRateAssociation, 'client_tax_rates_id' | 'created_at' | 'updated_at'> = {
        client_id: clientId,
        tax_rate_id: newTaxRateId,
        tenant: tenant!,
        is_default: true,
        location_id: null, // Ensure location_id is null for default in Phase 1
      };
      const [createdAssociation] = await db.table<IClientTaxRateAssociation>('client_tax_rates')
        .insert(dataToInsert)
        .returning('*');
      newDefaultAssociation = createdAssociation;
    }

    if (!newDefaultAssociation) {
      // This case should ideally not happen if the transaction logic is correct
      throw new Error('Default client tax-rate association update completed without returning a record.');
    }

    return newDefaultAssociation;
    });
  } catch (error) {
    const expected = clientTaxRateActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

/**
 * Fetches the region_code associated with the default tax rate for a client.
 * The default rate is identified by is_default = true and location_id IS NULL.
 * @param clientId The UUID of the client.
 * @returns The region_code string or null if no default rate/region is found.
 */
export const getClientDefaultTaxRegionCode = withAuth(async (
  user,
  { tenant },
  clientId: string
): Promise<string | null | ClientTaxRateActionError> => {
  try {
    await assertCanReadClientTaxRates(user);
  } catch (error) {
    const expected = clientTaxRateActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }

  try {
    const { knex } = await createTenantKnex();

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      return getClientDefaultTaxRegionCodeShared(trx, tenant, clientId);
    });
  } catch (error) {
    const expected = clientTaxRateActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});
