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
export async function addCompanyTaxRate(
  companyTaxRateData: Pick<ICompanyTaxRateAssociation, 'company_id' | 'tax_rate_id'>
): Promise<ICompanyTaxRateAssociation> {
  const { knex, tenant } = await createTenantKnex();

  // Phase 1 Constraint: Check if a default rate already exists
  const existingDefault = await knex('company_tax_rates')
    .where({
      company_id: companyTaxRateData.company_id,
      tenant: tenant,
      is_default: true
    })
    .first();

  if (existingDefault) {
    throw new Error('A default tax rate already exists for this company. Only one default rate is allowed in Phase 1.');
  }

  // Phase 1: Force is_default=true and location_id=null
 // Corrected Omit type to use plural 'rates' id
 const dataToInsert: Omit<ICompanyTaxRateAssociation, 'company_tax_rates_id' | 'created_at' | 'updated_at'> = {
    ...companyTaxRateData,
    tenant: tenant!,
    is_default: true,
    location_id: null
  };

  const [newCompanyTaxRate] = await knex('company_tax_rates')
    .insert(dataToInsert)
    .returning('*');

  return newCompanyTaxRate;
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
