'use server'

import { tenantDb, withTransaction } from '@alga-psa/db';
import { ITaxRate, DeletionValidationResult } from '@alga-psa/types';
import { TaxService } from '../services/taxService';
import { v4 as uuid4 } from 'uuid';
import { createTenantKnex } from '@alga-psa/db';
import { Knex } from 'knex';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { getAnalyticsAsync } from '../lib/authHelpers';
import { deleteEntityWithValidation } from '@alga-psa/core/server';
import { assertPsaOnlyTenantAccess } from '@shared/services/productAccessGuard';



export type DeleteTaxRateResult = DeletionValidationResult & { success: boolean; deleted?: boolean };

export const getTaxRates = withAuth(async (user, { tenant }): Promise<ITaxRate[]> => {
  try {
    await assertPsaOnlyTenantAccess(tenant, 'billing_actions');
    if (!await hasPermission(user, 'billing', 'read')) {
      throw new Error('Permission denied: Cannot read tax rates');
    }

    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      return await tenantDb(trx, tenant).table<ITaxRate>('tax_rates')
        .select('*');
    });
  } catch (error) {
    console.error('Error fetching tax rates:', error);
    throw new Error('Failed to fetch tax rates');
  }
});

export const addTaxRate = withAuth(async (user, { tenant }, taxRateData: Omit<ITaxRate, 'tax_rate_id'>): Promise<ITaxRate> => {
  try {
    await assertPsaOnlyTenantAccess(tenant, 'billing_actions');
    if (!await hasPermission(user, 'billing', 'create')) {
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

      const [newTaxRate] = await tenantDb(trx, tenant).table<ITaxRate>('tax_rates')
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
    await assertPsaOnlyTenantAccess(tenant, 'billing_actions');
    if (!await hasPermission(user, 'billing', 'update')) {
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
        const existingRate = await tenantDb(trx, tenant).table<ITaxRate>('tax_rates')
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

      const [updatedTaxRate] = await tenantDb(trx, tenant).table<ITaxRate>('tax_rates')
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

export const deleteTaxRate = withAuth(async (user, { tenant }, taxRateId: string): Promise<DeleteTaxRateResult> => {
  try {
    await assertPsaOnlyTenantAccess(tenant, 'billing_actions');
    if (!await hasPermission(user, 'billing', 'delete')) {
      throw new Error('Permission denied: billing delete required');
    }
    const { knex } = await createTenantKnex();
    const result = await deleteEntityWithValidation('tax_rate', taxRateId, knex, tenant, async (trx, tenantId) => {
      // Fail-fast tenant guard: confirm the tax rate belongs to this tenant before touching
      // any tenant-less child tables (composite_tax_mappings/tax_holidays/tax_rate_thresholds).
      const db = tenantDb(trx, tenant);
      const exists = await db.table('tax_rates')
        .where({ tax_rate_id: taxRateId })
        .first('tax_rate_id');
      if (!exists) {
        throw new Error('Tax rate not found or already deleted.');
      }

      // Clean up child records owned by the tax rate.
      // composite_tax_mappings/tax_holidays/tax_rate_thresholds have no tenant column
      // (in Citus, tax_rates.PK is compound (tenant, tax_rate_id), so tax_rate_id alone
      // isn't globally unique). Scope each delete by joining back to tax_rates with the
      // tenant guard so we can never touch another tenant's rows.
      const ownedTaxRate = db.table('tax_rates')
        .select('tax_rate_id')
        .where({ tax_rate_id: taxRateId });

      await db.unscoped('composite_tax_mappings', 'tenant-less tax child scoped through tenant-owned tax_rates')
        .where({ composite_tax_id: taxRateId })
        .whereIn('composite_tax_id', ownedTaxRate.clone())
        .del();
      await db.table('tax_components').where({ tax_rate_id: taxRateId }).del();
      await db.unscoped('tax_holidays', 'tenant-less tax child scoped through tenant-owned tax_rates')
        .where({ tax_rate_id: taxRateId })
        .whereIn('tax_rate_id', ownedTaxRate.clone())
        .del();
      await db.unscoped('tax_rate_thresholds', 'tenant-less tax child scoped through tenant-owned tax_rates')
        .where({ tax_rate_id: taxRateId })
        .whereIn('tax_rate_id', ownedTaxRate.clone())
        .del();

      const deletedCount = await db.table('tax_rates')
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

export const confirmDeleteTaxRate = withAuth(async (user, _ctx, taxRateId: string): Promise<DeleteTaxRateResult> => {
  if (!await hasPermission(user, 'billing', 'delete')) {
    throw new Error('Permission denied: billing delete required');
  }
  return deleteTaxRate(taxRateId);
});
