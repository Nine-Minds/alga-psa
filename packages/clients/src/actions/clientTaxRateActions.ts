'use server'

import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { createTenantKnex } from '@alga-psa/db';
import type { IClientTaxRateAssociation } from '@alga-psa/types';
import { getClientDefaultTaxRegionCode as getClientDefaultTaxRegionCodeShared } from '@alga-psa/shared/billingClients';
import { getCurrentUser } from '@alga-psa/auth/getCurrentUser';

// Combine association data with rate details
// Removed 'name' from Pick as it doesn't exist on the tax_rates table
export type ClientTaxRateDetails = IClientTaxRateAssociation & {
  tax_percentage: number;
  tax_type: 'VAT' | 'GST' | 'Sales Tax';
  country_code: string;
};

export async function getClientTaxRates(clientId: string): Promise<ClientTaxRateDetails[]> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('Unauthorized');
  }
  const { knex, tenant } = await createTenantKnex(currentUser.tenant);
  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await trx('client_tax_rates')
      .join('tax_rates', function() {
        this.on('client_tax_rates.tax_rate_id', '=', 'tax_rates.tax_rate_id')
            .andOn('client_tax_rates.tenant', '=', 'tax_rates.tenant');
      })
      .where({
        'client_tax_rates.client_id': clientId,
        'client_tax_rates.tenant': tenant
      })
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
}

// Phase 1: Only allow adding a single default rate per client.
// Handles inserting a new default OR updating an existing non-default rate to become the default.
export async function addClientTaxRate(
  clientTaxRateData: Pick<IClientTaxRateAssociation, 'client_id' | 'tax_rate_id'>
): Promise<IClientTaxRateAssociation> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('Unauthorized');
  }
  const { knex, tenant } = await createTenantKnex(currentUser.tenant);
  const { client_id, tax_rate_id } = clientTaxRateData; // Destructure for clarity

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    // 1. Phase 1 Constraint: Check if a default rate already exists
    const existingDefault = await trx('client_tax_rates')
      .where({
        client_id: client_id,
        tenant: tenant,
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
    let association = await trx('client_tax_rates')
      .where({
        client_id: client_id,
        tax_rate_id: tax_rate_id,
        tenant: tenant,
      })
      .first();

    if (association) {
      // 3a. If it exists, update it to be the default
      if (association.is_default) {
        // If it's already the default, just return it (no change needed)
        return association;
      }
      const [updatedAssociation] = await trx('client_tax_rates')
        .where('client_tax_rates_id', association.client_tax_rates_id)
        .andWhere('tenant', tenant)
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
      const [createdAssociation] = await trx('client_tax_rates')
        .insert(dataToInsert)
        .returning('*');
      association = createdAssociation;
    }

    if (!association) {
        throw new Error('Failed to assign the default tax rate association.');
    }

    return association;
  });
}

export async function removeClientTaxRate(clientId: string, taxRateId: string): Promise<void> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('Unauthorized');
  }
  const { knex, tenant } = await createTenantKnex(currentUser.tenant);
  await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await trx('client_tax_rates')
      .where({ 
        client_id: clientId,
        tax_rate_id: taxRateId,
        tenant
      })
      .del();
  });
}

// Phase 1: Update the default tax rate for a client
export async function updateDefaultClientTaxRate(
 clientId: string,
 newTaxRateId: string
): Promise<IClientTaxRateAssociation> {
 const currentUser = await getCurrentUser();
 if (!currentUser) {
   throw new Error('Unauthorized');
 }
 const { knex, tenant } = await createTenantKnex(currentUser.tenant);

 // Validate that the newTaxRateId exists for this tenant (optional but good practice)
 const newRateExists = await withTransaction(knex, async (trx: Knex.Transaction) => {
   return await trx('tax_rates')
     .where({ tax_rate_id: newTaxRateId, tenant: tenant })
     .first();
 });
 if (!newRateExists) {
   throw new Error(`Tax rate with ID ${newTaxRateId} not found.`);
 }

return await withTransaction(knex, async (trx: Knex.Transaction) => {
  // 1. Find the current default rate ID (if one exists)
  const currentDefaultResult = await trx('client_tax_rates')
   .select('client_tax_rates_id', 'tax_rate_id') // Corrected column name (plural rates)
    .where({
      client_id: clientId,
      tenant: tenant,
      is_default: true,
    })
    .first();

 const currentDefaultRatesId = currentDefaultResult?.client_tax_rates_id; // Corrected variable name
  const currentDefaultTaxRateId = currentDefaultResult?.tax_rate_id;

  if (currentDefaultTaxRateId && currentDefaultTaxRateId === newTaxRateId) {
    // If the selected rate is already the default, fetch and return the full record
    console.log('Selected rate is already the default. No change needed.');
   const fullCurrentDefault = await trx('client_tax_rates').where({ client_tax_rates_id: currentDefaultRatesId, tenant: tenant }).first(); // Corrected column name
    return fullCurrentDefault || Promise.reject('Failed to retrieve current default record.'); // Should not happen if ID exists
  }

 // 2. Unset the current default if it exists
 if (currentDefaultRatesId) { // Corrected variable name
   await trx('client_tax_rates')
     .where('client_tax_rates_id', currentDefaultRatesId) // Corrected column name
      .andWhere('tenant', tenant)
      .update({ is_default: false });
  }

   // 2. Find or create the association for the new rate
   let newDefaultAssociation = await trx('client_tax_rates')
     .where({
       client_id: clientId,
       tax_rate_id: newTaxRateId,
       tenant: tenant,
     })
     .first();

  if (newDefaultAssociation) {
    // If association exists, update it to be the default
    const [updatedAssociation] = await trx('client_tax_rates')
     .where('client_tax_rates_id', newDefaultAssociation.client_tax_rates_id) // Corrected column name
      .andWhere('tenant', tenant)
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
     const [createdAssociation] = await trx('client_tax_rates')
       .insert(dataToInsert)
       .returning('*');
     newDefaultAssociation = createdAssociation;
   }

   if (!newDefaultAssociation) {
       // This case should ideally not happen if the transaction logic is correct
       throw new Error('Failed to set the new default tax rate association.');
   }

   return newDefaultAssociation;
 });
}

/**
 * Fetches the region_code associated with the default tax rate for a client.
 * The default rate is identified by is_default = true and location_id IS NULL.
 * @param clientId The UUID of the client.
 * @returns The region_code string or null if no default rate/region is found.
 */
export async function getClientDefaultTaxRegionCode(clientId: string): Promise<string | null> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('Unauthorized');
  }
  const { knex, tenant } = await createTenantKnex(currentUser.tenant);

  try {
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      return getClientDefaultTaxRegionCodeShared(trx, tenant, clientId);
    });
  } catch (error) {
    console.error(`[getClientDefaultTaxRegionCode] Error fetching default tax region for client ${clientId}:`, error);
    return null;
  }
}
