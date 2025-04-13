'use server'

import { createTenantKnex } from 'server/src/lib/db';
import { ICompanyTaxRateAssociation, ITaxRate } from 'server/src/interfaces/tax.interfaces'; // Updated import

// Combine association data with rate details
// Removed 'name' from Pick as it doesn't exist on the tax_rates table
export type CompanyTaxRateDetails = ICompanyTaxRateAssociation & Pick<ITaxRate, 'tax_percentage' | 'tax_type' | 'country_code'>;

export async function getCompanyTaxRates(companyId: string): Promise<CompanyTaxRateDetails[]> {
  const { knex, tenant } = await createTenantKnex();
  return await knex('company_tax_rates')
    .join('tax_rates', function() {
      this.on('company_tax_rates.tax_rate_id', '=', 'tax_rates.tax_rate_id')
          .andOn('company_tax_rates.tenant', '=', 'tax_rates.tenant');
    })
    .where({
      'company_tax_rates.company_id': companyId,
      'company_tax_rates.tenant': tenant
    })
    .select(
      'company_tax_rates.*',
      'tax_rates.tax_percentage',
     // 'tax_rates.name', // Removed as 'name' column does not exist on tax_rates table
      'tax_rates.tax_type',
      'tax_rates.country_code'
      // Removed region_code and description as they are not in ITaxRate base definition
      // Add them back if they are needed and present in ITaxRate
    );
}

// Phase 1: Only allow adding a single default rate per company.
// Handles inserting a new default OR updating an existing non-default rate to become the default.
export async function addCompanyTaxRate(
  companyTaxRateData: Pick<ICompanyTaxRateAssociation, 'company_id' | 'tax_rate_id'>
): Promise<ICompanyTaxRateAssociation> {
  const { knex, tenant } = await createTenantKnex();
  const { company_id, tax_rate_id } = companyTaxRateData; // Destructure for clarity

  return await knex.transaction(async (trx) => {
    // 1. Phase 1 Constraint: Check if a default rate already exists
    const existingDefault = await trx('company_tax_rates')
      .where({
        company_id: company_id,
        tenant: tenant,
        is_default: true
      })
      // Exclude the rate we are trying to set as default, in case it already exists but is not default
      .andWhereNot('tax_rate_id', tax_rate_id)
      .first();

    if (existingDefault) {
      // If a *different* rate is already default, prevent adding another one in Phase 1
      throw new Error('A default tax rate already exists for this company. Only one default rate is allowed.');
    }

    // 2. Check if the specific association already exists (even if not default)
    let association = await trx('company_tax_rates')
      .where({
        company_id: company_id,
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
      const [updatedAssociation] = await trx('company_tax_rates')
        .where('company_tax_rates_id', association.company_tax_rates_id)
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
      const dataToInsert: Omit<ICompanyTaxRateAssociation, 'company_tax_rates_id' | 'created_at' | 'updated_at'> = {
        company_id: company_id,
        tax_rate_id: tax_rate_id,
        tenant: tenant!,
        is_default: true,
        location_id: null // Ensure location_id is null for default in Phase 1
      };
      const [createdAssociation] = await trx('company_tax_rates')
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

export async function removeCompanyTaxRate(companyId: string, taxRateId: string): Promise<void> {
  const { knex, tenant } = await createTenantKnex();
  await knex('company_tax_rates')
    .where({ 
      company_id: companyId,
      tax_rate_id: taxRateId,
      tenant
    })
    .del();
}

// Phase 1: Update the default tax rate for a company
export async function updateDefaultCompanyTaxRate(
 companyId: string,
 newTaxRateId: string
): Promise<ICompanyTaxRateAssociation> {
 const { knex, tenant } = await createTenantKnex();

 // Validate that the newTaxRateId exists for this tenant (optional but good practice)
 const newRateExists = await knex('tax_rates')
   .where({ tax_rate_id: newTaxRateId, tenant: tenant })
   .first();
 if (!newRateExists) {
   throw new Error(`Tax rate with ID ${newTaxRateId} not found.`);
 }

return await knex.transaction(async (trx) => {
  // 1. Find the current default rate ID (if one exists)
  const currentDefaultResult = await trx('company_tax_rates')
   .select('company_tax_rates_id', 'tax_rate_id') // Corrected column name (plural rates)
    .where({
      company_id: companyId,
      tenant: tenant,
      is_default: true,
    })
    .first();

 const currentDefaultRatesId = currentDefaultResult?.company_tax_rates_id; // Corrected variable name
  const currentDefaultTaxRateId = currentDefaultResult?.tax_rate_id;

  if (currentDefaultTaxRateId && currentDefaultTaxRateId === newTaxRateId) {
    // If the selected rate is already the default, fetch and return the full record
    console.log('Selected rate is already the default. No change needed.');
   const fullCurrentDefault = await trx('company_tax_rates').where({ company_tax_rates_id: currentDefaultRatesId, tenant: tenant }).first(); // Corrected column name
    return fullCurrentDefault || Promise.reject('Failed to retrieve current default record.'); // Should not happen if ID exists
  }

 // 2. Unset the current default if it exists
 if (currentDefaultRatesId) { // Corrected variable name
   await trx('company_tax_rates')
     .where('company_tax_rates_id', currentDefaultRatesId) // Corrected column name
      .andWhere('tenant', tenant)
      .update({ is_default: false });
  }

   // 2. Find or create the association for the new rate
   let newDefaultAssociation = await trx('company_tax_rates')
     .where({
       company_id: companyId,
       tax_rate_id: newTaxRateId,
       tenant: tenant,
     })
     .first();

  if (newDefaultAssociation) {
    // If association exists, update it to be the default
    const [updatedAssociation] = await trx('company_tax_rates')
     .where('company_tax_rates_id', newDefaultAssociation.company_tax_rates_id) // Corrected column name
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
    const dataToInsert: Omit<ICompanyTaxRateAssociation, 'company_tax_rates_id' | 'created_at' | 'updated_at'> = {
       company_id: companyId,
       tax_rate_id: newTaxRateId,
       tenant: tenant!,
       is_default: true,
       location_id: null, // Ensure location_id is null for default in Phase 1
     };
     const [createdAssociation] = await trx('company_tax_rates')
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
 * Fetches the region_code associated with the default tax rate for a company.
 * The default rate is identified by is_default = true and location_id IS NULL.
 * @param companyId The UUID of the company.
 * @returns The region_code string or null if no default rate/region is found.
 */
export async function getCompanyDefaultTaxRegionCode(companyId: string): Promise<string | null> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    console.error("[getCompanyDefaultTaxRegionCode] Tenant context not found.");
    // Depending on strictness, could throw an error or return null.
    // Returning null allows calling functions to potentially fallback.
    return null;
  }

  try {
    const result = await knex('company_tax_rates as ctr')
      .join('tax_rates as tr', function() {
        this.on('ctr.tax_rate_id', '=', 'tr.tax_rate_id')
            .andOn('ctr.tenant', '=', 'tr.tenant');
      })
      .where({
        'ctr.company_id': companyId,
        'ctr.tenant': tenant,
        'ctr.is_default': true,
      })
      .whereNull('ctr.location_id') // Ensure it's the company-wide default
      .select('tr.region_code')
      .first();

    if (result && result.region_code) {
      console.log(`[getCompanyDefaultTaxRegionCode] Found default region code '${result.region_code}' for company ${companyId}`);
      return result.region_code;
    } else {
      console.warn(`[getCompanyDefaultTaxRegionCode] No default tax region code found for company ${companyId} using company_tax_rates.`);
      // Attempt fallback to companies.region_code for backward compatibility or misconfiguration?
      // Or strictly return null? For now, let's strictly return null based on the new table.
      // const companyFallback = await knex('companies').where({ company_id: companyId, tenant: tenant }).select('region_code').first();
      // if (companyFallback && companyFallback.region_code) {
      //   console.warn(`[getCompanyDefaultTaxRegionCode] Falling back to companies.region_code: ${companyFallback.region_code}`);
      //   return companyFallback.region_code;
      // }
      return null;
    }
  } catch (error) {
      console.error(`[getCompanyDefaultTaxRegionCode] Error fetching default tax region for company ${companyId}:`, error);
      return null; // Return null on error
  }
}
