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
import { assertPsaOnlyTenantAccess, ProductAccessError } from '@shared/services/productAccessGuard';
import {
  actionError,
  permissionError,
  isActionMessageError,
  isActionPermissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';



export type DeleteTaxRateResult = DeletionValidationResult & { success: boolean; deleted?: boolean };
type TaxRateActionError = ActionMessageError | ActionPermissionError;

function taxRateActionErrorFrom(error: unknown): TaxRateActionError | null {
  if (error instanceof ProductAccessError) {
    return permissionError('Permission denied: Billing tax rates are not available for this tenant.', 'msp/billing-settings:errors.taxRate.notAvailableForTenant');
  }
  if (error instanceof Error) {
    if (error.message.startsWith('Permission denied')) {
      return permissionError(error.message);
    }
    if (error.message.includes('Tax rate date range overlaps')) {
      return actionError('Tax rate date range overlaps with an existing rate for this region.', 'msp/billing-settings:errors.taxRate.overlap');
    }
    switch (error.message) {
      case 'Region is required':
        return actionError('Region is required.', 'msp/billing-settings:errors.taxRate.regionRequired');
      case 'Tax rate ID is required for updates':
        return actionError('Tax rate ID is required for updates.', 'msp/billing-settings:errors.taxRate.idRequired');
      case 'Tax rate not found':
        return actionError('Tax rate not found.', 'msp/billing-settings:errors.taxRate.notFound');
      // Thrown by deleteTaxRate's in-transaction guards; intentionally
      // user-visible, so keep the wording rather than degrading to the
      // generic delete fallback.
      case 'Tax rate not found or already deleted.':
        return actionError(
          'Tax rate not found or already deleted.',
          'msp/billing-settings:errors.taxRate.notFoundOrAlreadyDeleted'
        );
    }
  }

  const dbError = error as { code?: string; column?: string };
  if (dbError?.code === '22P02') {
    return actionError('The selected tax rate or region is invalid. Please refresh and try again.', 'msp/billing-settings:errors.taxRate.invalid');
  }
  if (dbError?.code === '23502') {
    return dbError.column
      ? actionError(
          `Missing required tax rate field: ${dbError.column}.`,
          'msp/billing-settings:errors.taxRate.missingFieldNamed',
          { field: dbError.column },
        )
      : actionError('Missing required tax rate field.', 'msp/billing-settings:errors.taxRate.missingField');
  }
  if (dbError?.code === '23503') {
    return actionError('The selected tax region is no longer valid. Please refresh and choose another region.', 'msp/billing-settings:errors.taxRate.regionInvalid');
  }
  if (dbError?.code === '23505') {
    return actionError('A tax rate already exists for this region and date range.', 'msp/billing-settings:errors.taxRate.duplicate');
  }

  return null;
}

export const getTaxRates = withAuth(async (user, { tenant }): Promise<ITaxRate[] | TaxRateActionError> => {
  try {
    await assertPsaOnlyTenantAccess(tenant, 'billing_actions');
    if (!await hasPermission(user, 'billing', 'read')) {
      return permissionError('Permission denied: Cannot read tax rates', 'msp/billing-settings:errors.permissions.readTaxRates');
    }

    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      return await tenantDb(trx, tenant).table<ITaxRate>('tax_rates')
        .select('*');
    });
  } catch (error) {
    const expected = taxRateActionErrorFrom(error);
    if (expected) {
      return expected;
    }

    console.error('Error fetching tax rates:', error);
    throw error;
  }
});

export const addTaxRate = withAuth(async (
  user,
  { tenant },
  taxRateData: Omit<ITaxRate, 'tax_rate_id'>
): Promise<ITaxRate | TaxRateActionError> => {
  try {
    await assertPsaOnlyTenantAccess(tenant, 'billing_actions');
    if (!await hasPermission(user, 'billing', 'create')) {
      return permissionError('Permission denied: Cannot create tax rates', 'msp/billing-settings:errors.permissions.createTaxRates');
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
    const expected = taxRateActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

export const updateTaxRate = withAuth(async (
  user,
  { tenant },
  taxRateData: ITaxRate
): Promise<ITaxRate | TaxRateActionError> => {
  try {
    await assertPsaOnlyTenantAccess(tenant, 'billing_actions');
    if (!await hasPermission(user, 'billing', 'update')) {
      return permissionError('Permission denied: Cannot update tax rates', 'msp/billing-settings:errors.permissions.updateTaxRates');
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
    const expected = taxRateActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

export const deleteTaxRate = withAuth(async (user, { tenant }, taxRateId: string): Promise<DeleteTaxRateResult> => {
  try {
    await assertPsaOnlyTenantAccess(tenant, 'billing_actions');
    if (!await hasPermission(user, 'billing', 'delete')) {
      return {
        success: false,
        canDelete: false,
        code: 'PERMISSION_DENIED',
        message: 'Permission denied: billing delete required',
        dependencies: [],
        alternatives: [],
      };
    }
    const { knex } = await createTenantKnex();
    const result = await deleteEntityWithValidation('tax_rate', taxRateId, knex, tenant, async (trx, tenantId) => {
      // Fail-fast tenant guard: confirm the tax rate belongs to this tenant before touching
      // child tables scoped through tax_rates.
      const db = tenantDb(trx, tenantId);
      const exists = await db.table('tax_rates')
        .where({ tax_rate_id: taxRateId })
        .first('tax_rate_id');
      if (!exists) {
        throw new Error('Tax rate not found or already deleted.');
      }

      await db.parentScopedTable('composite_tax_mappings')
        .where({ composite_tax_id: taxRateId })
        .del();
      await db.table('tax_components').where({ tax_rate_id: taxRateId }).del();
      await db.parentScopedTable('tax_holidays')
        .where({ tax_rate_id: taxRateId })
        .del();
      await db.parentScopedTable('tax_rate_thresholds')
        .where({ tax_rate_id: taxRateId })
        .del();

      const deletedCount = await db.table('tax_rates')
        .where({ tax_rate_id: taxRateId })
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

    // Never echo error.message to the client: raw Postgres/Knex failures here
    // carry the interpolated SQL statement, which DeleteEntityDialog renders
    // verbatim. Only messages this action recognises are user-visible.
    const expected: unknown = taxRateActionErrorFrom(error);
    if (isActionPermissionError(expected)) {
      return {
        success: false,
        canDelete: false,
        code: 'PERMISSION_DENIED',
        message: expected.permissionError,
        dependencies: [],
        alternatives: []
      };
    }
    if (isActionMessageError(expected)) {
      return {
        success: false,
        canDelete: false,
        code: 'VALIDATION_FAILED',
        message: expected.actionError,
        dependencies: [],
        alternatives: []
      };
    }

    return {
      success: false,
      canDelete: false,
      code: 'VALIDATION_FAILED',
      message: 'Failed to delete tax rate. Please refresh and try again.',
      dependencies: [],
      alternatives: []
    };
  }
});

export const confirmDeleteTaxRate = withAuth(async (user, _ctx, taxRateId: string): Promise<DeleteTaxRateResult> => {
  if (!await hasPermission(user, 'billing', 'delete')) {
    return {
      success: false,
      canDelete: false,
      code: 'PERMISSION_DENIED',
      message: 'Permission denied: billing delete required',
      dependencies: [],
      alternatives: [],
    };
  }
  return deleteTaxRate(taxRateId);
});
