'use server'

import { withTransaction } from '@alga-psa/shared/db';
import { ITaxRate, IService } from 'server/src/interfaces/billing.interfaces';
import { TaxService } from '@server/lib/services/taxService';
import { v4 as uuid4 } from 'uuid';
import { createTenantKnex } from '@server/lib/db';
import { Knex } from 'knex';
import { getCurrentUser } from './user-actions/userActions';
import { hasPermission } from '@server/lib/auth/rbac';

export type DeleteTaxRateResult = {
  deleted: boolean;
  affectedServices?: Pick<IService, 'service_id' | 'service_name'>[];
};

export async function getTaxRates(): Promise<ITaxRate[]> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('No authenticated user found');
    }

    if (!await hasPermission(currentUser, 'billing', 'read')) {
      throw new Error('Permission denied: Cannot read tax rates');
    }

    const { knex: db, tenant } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      return await trx('tax_rates')
        .where({ tenant })
        .select('*');
    });
  } catch (error) {
    console.error('Error fetching tax rates:', error);
    throw new Error('Failed to fetch tax rates');
  }
}

export async function addTaxRate(taxRateData: Omit<ITaxRate, 'tax_rate_id'>): Promise<ITaxRate> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('No authenticated user found');
    }

    if (!await hasPermission(currentUser, 'billing', 'create')) {
      throw new Error('Permission denied: Cannot create tax rates');
    }

    const { knex: db, tenant } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const taxService = new TaxService();
    
    if (!taxRateData.region_code) {
      throw new Error('Region is required');
    }

    // Validate date range before insertion
    await taxService.validateTaxRateDateRange(
      taxRateData.region_code,
      taxRateData.start_date,
      taxRateData.end_date || null
    );

    // Generate a UUID for the tax_rate_id
    const tax_rate_id = uuid4();

      const [newTaxRate] = await trx('tax_rates')
        .insert({ ...taxRateData, tax_rate_id, tenant: tenant! })
        .returning('*');
      return newTaxRate;
    });
  } catch (error: any) {
    console.error('Error adding tax rate:', error);
    throw new Error(error.message || 'Failed to add tax rate');
  }
}

export async function updateTaxRate(taxRateData: ITaxRate): Promise<ITaxRate> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('No authenticated user found');
    }

    if (!await hasPermission(currentUser, 'billing', 'update')) {
      throw new Error('Permission denied: Cannot update tax rates');
    }

    const { knex: db, tenant } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const taxService = new TaxService();
    
    if (!taxRateData.tax_rate_id) {
      throw new Error('Tax rate ID is required for updates');
    }

    // Validate date range before update, excluding current tax rate
    if (taxRateData.start_date || taxRateData.end_date) {
      const existingRate = await trx('tax_rates')
        .where({
          tax_rate_id: taxRateData.tax_rate_id,
          tenant
        })
        .first();

      if (!existingRate) {
        throw new Error('Tax rate not found');
      }

      if (!taxRateData.region_code) {
        throw new Error('Region is required');
      }

      await taxService.validateTaxRateDateRange(
        taxRateData.region_code,
        taxRateData.start_date,
        taxRateData.end_date || null,
        taxRateData.tax_rate_id
      );
    }

    // Clean up the data before update and exclude partition key (tenant)
    const { tenant: _, ...updateData } = { ...taxRateData };
    if (updateData.end_date === '') {
      updateData.end_date = null;
    }

    const [updatedTaxRate] = await trx('tax_rates')
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
    });
  } catch (error: any) {
    console.error('Error updating tax rate:', error);
    throw new Error(error.message || 'Failed to update tax rate');
  }
}

export async function deleteTaxRate(taxRateId: string): Promise<DeleteTaxRateResult> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('No authenticated user found');
    }

    // Need both read and delete permissions since we're checking for affected services and potentially deleting
    if (!await hasPermission(currentUser, 'billing', 'read')) {
      throw new Error('Permission denied: Cannot read tax rate information');
    }

    if (!await hasPermission(currentUser, 'billing', 'delete')) {
      throw new Error('Permission denied: Cannot delete tax rates');
    }

    const { knex: db, tenant } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {

    const affectedServices = await trx('service_catalog')
      .where({ tenant, tax_rate_id: taxRateId })
      .select('service_id', 'service_name');

    if (affectedServices.length > 0) {
      return { deleted: false, affectedServices };
    } else {
      const deletedCount = await trx('tax_rates')
        .where({
          tax_rate_id: taxRateId,
          tenant
        })
        .del();

      if (deletedCount === 0) {
        throw new Error('Tax rate not found or already deleted.');
      }
        return { deleted: true };
      }
    });
  } catch (error: any) {
    console.error('Error processing tax rate deletion:', error);
    if (error.message.includes('Tax rate not found')) {
        throw error;
    }
    throw new Error('Failed to process tax rate deletion request.');
  }
}

export async function confirmDeleteTaxRate(taxRateId: string): Promise<void> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('No authenticated user found');
    }

    // Need delete permission for tax rates and update permission for services
    if (!await hasPermission(currentUser, 'billing', 'delete')) {
      throw new Error('Permission denied: Cannot delete tax rates');
    }

    const { knex: db, tenant } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      await trx('service_catalog')
        .where({ tenant, tax_rate_id: taxRateId })
        .update({ tax_rate_id: null });

      const deletedCount = await trx('tax_rates')
        .where({
          tax_rate_id: taxRateId,
          tenant
        })
        .del();

        if (deletedCount === 0) {
          throw new Error('Tax rate not found during confirmed deletion.');
        }
    });
  } catch (error: any) {
    console.error('Error confirming tax rate deletion:', error);
    throw new Error(error.message || 'Failed to confirm tax rate deletion.');
  }
}
