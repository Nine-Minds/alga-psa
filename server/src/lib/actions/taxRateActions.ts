'use server'

import { createTenantKnex } from '@/lib/db';
import { ITaxRate } from '@/interfaces/billing.interfaces';

export async function getTaxRates(): Promise<ITaxRate[]> {
  try {
    const { knex, tenant } = await createTenantKnex();
    return await knex('tax_rates')
      .where({ tenant })
      .select('*');
  } catch (error) {
    console.error('Error fetching tax rates:', error);
    throw new Error('Failed to fetch tax rates');
  }
}

export async function addTaxRate(taxRateData: Omit<ITaxRate, 'tax_rate_id'>): Promise<ITaxRate> {
  try {
    const { knex, tenant } = await createTenantKnex();
    const [newTaxRate] = await knex('tax_rates').insert({ ...taxRateData, tenant: tenant! }).returning('*');
    return newTaxRate;
  } catch (error) {
    console.error('Error adding tax rate:', error);
    throw new Error('Failed to add tax rate');
  }
}

export async function updateTaxRate(taxRateId: string, taxRateData: Partial<ITaxRate>): Promise<ITaxRate> {
  try {
    const { knex, tenant } = await createTenantKnex();
    const [updatedTaxRate] = await knex('tax_rates')
      .where({ 
        tax_rate_id: taxRateId,
        tenant 
      })
      .update(taxRateData)
      .returning('*');
    if (!updatedTaxRate) {
      throw new Error('Tax rate not found');
    }
    return updatedTaxRate;
  } catch (error) {
    console.error('Error updating tax rate:', error);
    throw new Error('Failed to update tax rate');
  }
}

export async function deleteTaxRate(taxRateId: string): Promise<void> {
  try {
    const { knex, tenant } = await createTenantKnex();
    const deletedCount = await knex('tax_rates')
      .where({ 
        tax_rate_id: taxRateId,
        tenant 
      })
      .del();
    if (deletedCount === 0) {
      throw new Error('Tax rate not found');
    }
  } catch (error) {
    console.error('Error deleting tax rate:', error);
    throw new Error('Failed to delete tax rate');
  }
}
