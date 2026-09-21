'use server'

import { tenantDb, withTransaction } from '@alga-psa/db';
import { ITaxRate, DeletionValidationResult } from '@alga-psa/types';
import { TaxService, normalizeTaxCapAmount } from '../services/taxService';
import { v4 as uuid4 } from 'uuid';
import { createTenantKnex } from '@alga-psa/db';
import { Knex } from 'knex';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { isSupportedCurrency } from '@alga-psa/core';
import { deleteEntityWithValidation } from '@alga-psa/core/server';
import {
  isTaxRateUsableAsDefault,
  lockTaxRegionRow,
  readConfiguredDefaultTaxRateId,
} from '@alga-psa/shared/billingClients/defaultTaxRate';
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
      case 'Tax rate cap amount must be a non-negative whole number.':
        return actionError('Tax rate cap amount must be a non-negative whole number.', 'msp/billing-settings:errors.taxRate.capInvalid');
      case 'Tax rate cap requires an explicit currency.':
        return actionError('Choose a rate currency before setting or changing a tax cap.', 'msp/billing-settings:errors.taxRate.capCurrencyRequired');
      case 'Tax rate currency is unsupported.':
        return actionError('Choose a supported rate currency.', 'msp/billing-settings:errors.taxRate.currencyInvalid');
      // Thrown by deleteTaxRate's in-transaction guards; intentionally
      // user-visible, so keep the wording rather than degrading to the
      // generic delete fallback.
      case 'Tax rate not found or already deleted.':
        return actionError(
          'Tax rate not found or already deleted.',
          'msp/billing-settings:errors.taxRate.notFoundOrAlreadyDeleted'
        );
      case 'This tax rate is the tenant default and these changes would make it invalid. Choose a different default first, then edit this rate.':
        return actionError(
          'This tax rate is the tenant default and these changes would make it invalid. Choose a different default first, then edit this rate.',
          'msp/billing-settings:errors.taxRate.defaultMutationBlocked'
        );
      case 'This tax rate is the tenant default. Choose a different default in Billing Settings before deleting it.':
        return actionError(
          'This tax rate is the tenant default. Choose a different default in Billing Settings before deleting it.',
          'msp/billing-settings:errors.taxRate.defaultDeleteBlocked'
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

function normalizeRate(row: ITaxRate): ITaxRate {
  return { ...row, cap_amount: normalizeTaxCapAmount(row.cap_amount), currency_code: row.currency_code ?? null };
}

function validateCurrency(currency: unknown): asserts currency is string | null {
  if (currency !== null && (typeof currency !== 'string' || !isSupportedCurrency(currency))) {
    throw new Error('Tax rate currency is unsupported.');
  }
}

export const getTaxRatePermissions = withAuth(async (user, { tenant }): Promise<{
  canCreate: boolean; canUpdate: boolean; canDelete: boolean;
} | TaxRateActionError> => {
  try {
    await assertPsaOnlyTenantAccess(tenant, 'billing_actions');
    if (!await hasPermission(user, 'billing', 'read')) {
      return permissionError('Permission denied: Cannot read tax rates', 'msp/billing-settings:errors.permissions.readTaxRates');
    }
    const [canCreate, canUpdate, canDelete] = await Promise.all([
      hasPermission(user, 'billing', 'create'),
      hasPermission(user, 'billing', 'update'),
      hasPermission(user, 'billing', 'delete'),
    ]);
    return { canCreate, canUpdate, canDelete };
  } catch (error) {
    const expected = taxRateActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

export const getTaxRates = withAuth(async (user, { tenant }): Promise<ITaxRate[] | TaxRateActionError> => {
  try {
    await assertPsaOnlyTenantAccess(tenant, 'billing_actions');
    if (!await hasPermission(user, 'billing', 'read')) {
      return permissionError('Permission denied: Cannot read tax rates', 'msp/billing-settings:errors.permissions.readTaxRates');
    }

    const { knex: db } = await createTenantKnex();
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      const rates = await tenantDb(trx, tenant).table<ITaxRate>('tax_rates').select('*');
      return rates.map(normalizeRate);
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
    return await withTransaction(db, async (trx: Knex.Transaction) => {
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
      // Validate the cap before it reaches the database; throws the mapped
      // "cap amount" action error for negative/fractional/non-numeric values.
      const cap_amount = normalizeTaxCapAmount(taxRateData.cap_amount);
      const currency_code = taxRateData.currency_code ?? null;
      validateCurrency(currency_code);
      if (cap_amount !== null && currency_code === null) {
        throw new Error('Tax rate cap requires an explicit currency.');
      }

      const [newTaxRate] = await tenantDb(trx, tenant).table<ITaxRate>('tax_rates')
        .insert({ ...taxRateData, cap_amount, currency_code, tax_rate_id, tenant: tenant! })
        .returning('*');
      return normalizeRate(newTaxRate);
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
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      const taxService = new TaxService();

      if (!taxRateData.tax_rate_id) {
        throw new Error('Tax rate ID is required for updates');
      }

      // Lock and validate the effective pair in the authenticated tenant. Omission
      // preserves either field, and unrelated edits preserve unresolved legacy caps.
      const existingRate = await tenantDb(trx, tenant).table<ITaxRate>('tax_rates')
        .where({ tax_rate_id: taxRateData.tax_rate_id }).forUpdate().first();
      if (!existingRate) throw new Error('Tax rate not found');

      if (taxRateData.start_date !== undefined || taxRateData.end_date !== undefined || taxRateData.region_code !== undefined) {
        await taxService.validateTaxRateDateRange(
          taxRateData.region_code ?? existingRate.region_code,
          taxRateData.start_date ?? existingRate.start_date,
          taxRateData.end_date === undefined ? existingRate.end_date ?? null : taxRateData.end_date || null,
          taxRateData.tax_rate_id
        );
      }

      // Clean up the data before update and exclude partition key (tenant)
      const { tenant: _, ...updateData } = { ...taxRateData };
      if (updateData.end_date === '') {
        updateData.end_date = null;
      }
      const hasCap = taxRateData.cap_amount !== undefined;
      const hasCurrency = taxRateData.currency_code !== undefined;
      if (hasCap) updateData.cap_amount = normalizeTaxCapAmount(taxRateData.cap_amount);
      else delete updateData.cap_amount;
      if (hasCurrency) validateCurrency(updateData.currency_code);
      else delete updateData.currency_code;

      const oldCap = normalizeTaxCapAmount(existingRate.cap_amount);
      const oldCurrency = existingRate.currency_code ?? null;
      const effectiveCap = hasCap ? updateData.cap_amount : oldCap;
      const effectiveCurrency = hasCurrency ? updateData.currency_code : oldCurrency;
      const unchangedPair = effectiveCap === oldCap && effectiveCurrency === oldCurrency;
      if (!unchangedPair && effectiveCap !== null) {
        if (effectiveCurrency == null) throw new Error('Tax rate cap requires an explicit currency.');
        validateCurrency(effectiveCurrency);
      }

      // Lock the effective region (lock order: tax_rates -> tax_regions) before
      // reading the configured default, so a concurrent region deactivation
      // cannot slip between this check and the update.
      const effectiveRegionCode =
        (updateData as Partial<ITaxRate>).region_code ?? existingRate.region_code;
      await lockTaxRegionRow(trx, tenant, effectiveRegionCode);

      // Lifecycle guard: a configured tenant default must remain usable. Changing
      // its region, deactivating it, or shifting its date range so it no longer
      // applies today would silently invalidate every future default assignment.
      const configuredDefaultId = await readConfiguredDefaultTaxRateId(trx, tenant);
      if (configuredDefaultId === taxRateData.tax_rate_id) {
        const nextRate = {
          is_active: updateData.is_active !== undefined ? Boolean(updateData.is_active) : existingRate.is_active,
          region_code: updateData.region_code ?? existingRate.region_code,
          start_date: updateData.start_date ?? existingRate.start_date,
          end_date: updateData.end_date === undefined ? existingRate.end_date : updateData.end_date,
        };
        if (!(await isTaxRateUsableAsDefault(trx, tenant, nextRate))) {
          throw new Error('This tax rate is the tenant default and these changes would make it invalid. Choose a different default first, then edit this rate.');
        }
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
      return normalizeRate(updatedTaxRate);
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

    // A configured tenant default cannot be deleted until it is cleared or
    // replaced: deleting it would leave new clients/catalog items with no
    // usable default.
    const configuredDefaultId = await readConfiguredDefaultTaxRateId(knex, tenant);
    if (configuredDefaultId === taxRateId) {
      return {
        success: false,
        canDelete: false,
        code: 'IS_DEFAULT',
        message: 'This tax rate is the tenant default. Choose a different default in Billing Settings before deleting it.',
        dependencies: [
          {
            type: 'tenant_default_tax_rate',
            count: 1,
            label: 'Tenant default tax rate',
            description: 'New clients, products, and services inherit this rate.',
          },
        ],
        alternatives: [
          {
            action: 'replace_default',
            label: 'Choose a replacement default',
            description: 'Set another rate as the tenant default in Billing Settings → Tax Rates, then delete this one.',
          },
        ],
      };
    }

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
