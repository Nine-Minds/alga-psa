'use server'

import { withTransaction } from '@alga-psa/db';
import { ITaxRate, DeletionValidationResult } from '@alga-psa/types';
import { TaxService } from '../services/taxService';
import { v4 as uuid4 } from 'uuid';
import { createTenantKnex } from '@alga-psa/db';
import { Knex } from 'knex';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { getAnalyticsAsync } from '../lib/authHelpers';
import { deleteEntityWithValidation } from '@alga-psa/core';



export type DeleteTaxRateResult = DeletionValidationResult & { success: boolean; deleted?: boolean };

export const getTaxRates = withAuth(async (user, { tenant }): Promise<ITaxRate[]> => {
  try {
    if (!hasPermission(user, 'billing', 'read')) {
      throw new Error('Permission denied: Cannot read tax rates');
    }

    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      return await trx('tax_rates')
        .where({ tenant })
        .select('*');
    });
  } catch (error) {
    console.error('Error fetching tax rates:', error);
    throw new Error('Failed to fetch tax rates');
  }
});

export const addTaxRate = withAuth(async (user, { tenant }, taxRateData: Omit<ITaxRate, 'tax_rate_id'>): Promise<ITaxRate> => {
  try {
    if (!hasPermission(user, 'billing', 'create')) {
      throw new Error('Permission denied: Cannot create tax rates');
    }

    const { knex: db } = await createTenantKnex();
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
});

export const updateTaxRate = withAuth(async (user, { tenant }, taxRateData: ITaxRate): Promise<ITaxRate> => {
  try {
    if (!hasPermission(user, 'billing', 'update')) {
      throw new Error('Permission denied: Cannot update tax rates');
    }

    const { knex: db } = await createTenantKnex();
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
});

export const deleteTaxRate = withAuth(async (_user, { tenant }, taxRateId: string): Promise<DeleteTaxRateResult> => {
  try {
    const { knex } = await createTenantKnex();
    const result = await deleteEntityWithValidation('tax_rate', taxRateId, knex, tenant, async (trx, tenantId) => {
      // Clean up child records owned by the tax rate
      await trx('composite_tax_mappings').where({ composite_tax_id: taxRateId, tenant }).del();
      await trx('tax_components').where({ tax_rate_id: taxRateId, tenant }).del();
      await trx('tax_holidays').where({ tax_rate_id: taxRateId, tenant }).del();
      await trx('tax_rate_thresholds').where({ tax_rate_id: taxRateId, tenant }).del();

      const deletedCount = await trx('tax_rates')
        .where({
          tax_rate_id: taxRateId,
          tenant
        })
        .del();

      if (deletedCount === 0) {
        throw new Error('Tax rate not found or already deleted.');
      }
    });

    return {
      ...result,
      success: result.deleted === true,
      deleted: result.deleted
    };
  } catch (error: any) {
    console.error('Error processing tax rate deletion:', error);
    return {
      success: false,
      canDelete: false,
      code: 'VALIDATION_FAILED',
      message: error?.message || 'Failed to process tax rate deletion request.',
      dependencies: [],
      alternatives: []
    };
  }
});

export const confirmDeleteTaxRate = withAuth(async (_user, _ctx, taxRateId: string): Promise<DeleteTaxRateResult> => {
  return deleteTaxRate(taxRateId);
});
