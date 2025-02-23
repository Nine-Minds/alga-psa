'use server'

import { createTenantKnex } from '@/lib/db';
import { ITaxRate } from '@/interfaces/billing.interfaces';
import { TaxService } from '@/lib/services/taxService';

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
    const taxService = new TaxService();
    
    if (!taxRateData.region) {
      throw new Error('Region is required');
    }

    // Validate date range before insertion
    await taxService.validateTaxRateDateRange(
      taxRateData.region,
      taxRateData.start_date,
      taxRateData.end_date || null
    );

    const [newTaxRate] = await knex('tax_rates')
      .insert({ ...taxRateData, tenant: tenant! })
      .returning('*');
    return newTaxRate;
  } catch (error: any) {
    console.error('Error adding tax rate:', error);
    throw new Error(error.message || 'Failed to add tax rate');
  }
}

export async function updateTaxRate(taxRateData: ITaxRate): Promise<ITaxRate> {
  try {
    const { knex, tenant } = await createTenantKnex();
    const taxService = new TaxService();
    
    if (!taxRateData.tax_rate_id) {
      throw new Error('Tax rate ID is required for updates');
    }

    // Validate date range before update, excluding current tax rate
    if (taxRateData.start_date || taxRateData.end_date) {
      const existingRate = await knex('tax_rates')
        .where({
          tax_rate_id: taxRateData.tax_rate_id,
          tenant
        })
        .first();

      if (!existingRate) {
        throw new Error('Tax rate not found');
      }

      if (!taxRateData.region) {
        throw new Error('Region is required');
      }

      await taxService.validateTaxRateDateRange(
        taxRateData.region,
        taxRateData.start_date,
        taxRateData.end_date || null,
        taxRateData.tax_rate_id
      );
    }

    // Clean up the data before update
    const updateData = { ...taxRateData };
    if (updateData.end_date === '') {
      updateData.end_date = null;
    }

    const [updatedTaxRate] = await knex('tax_rates')
      .where({
        tax_rate_id: updateData.tax_rate_id,
        tenant
      })
      .update(updateData)
      .returning('*');
    if (!updatedTaxRate) {
      throw new Error('Tax rate not found');
    }
    return updatedTaxRate;
  } catch (error: any) {
    console.error('Error updating tax rate:', error);
    throw new Error(error.message || 'Failed to update tax rate');
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
