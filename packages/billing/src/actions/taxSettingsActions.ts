'use server'

import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { IClientTaxSettings, ITaxRate, ITaxComponent, ITaxRateThreshold, ITaxHoliday } from '@alga-psa/types';
import { v4 as uuid4 } from 'uuid';
import { TaxService } from '../services/taxService';
import { ITaxRegion } from '@alga-psa/types';
import { Knex } from 'knex';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

type TaxSettingsActionError = ActionMessageError | ActionPermissionError;
type TaxRegionActionError = TaxSettingsActionError;

function taxSettingsActionErrorFrom(error: unknown): TaxSettingsActionError | null {
  if (error instanceof Error) {
    if (error.message.startsWith('Permission denied')) {
      return permissionError(error.message);
    }

    switch (error.message) {
      case 'Invalid tax rate or component reference. Please check your selections.':
      case 'Duplicate entry detected. Please check your tax components or thresholds.':
      case 'One or more tax settings components could not be found.':
      case 'Client not found':
        return actionError(error.message);
      case 'Tenant context is required':
      case 'SYSTEM_ERROR: Tenant context not found':
        return actionError('No tenant context. Please refresh and try again.');
      case 'No active tax rates found in the system to assign as default.':
      case 'Failed to create default tax settings':
        return actionError('Configure at least one active tax rate before creating default tax settings.');
      case 'Tax component not found':
        return actionError('Tax component not found. It may have been updated or deleted. Please refresh and try again.');
      case 'Tax threshold not found':
        return actionError('Tax bracket not found. It may have been updated or deleted. Please refresh and try again.');
      case 'Tax holiday not found':
        return actionError('Tax holiday not found. It may have been updated or deleted. Please refresh and try again.');
    }
  }

  const dbError = error as { code?: string; column?: string };
  if (dbError?.code === '22P02') {
    return actionError('One of the selected tax records is invalid. Please refresh and try again.');
  }
  if (dbError?.code === '23502') {
    return actionError(`Missing required tax field${dbError.column ? `: ${dbError.column}` : ''}.`);
  }
  if (dbError?.code === '23503') {
    return actionError('One of the selected tax records no longer exists. Please refresh and try again.');
  }
  if (dbError?.code === '23505') {
    return actionError('A tax record with those details already exists.');
  }
  if (dbError?.code === '23514') {
    return actionError('One of the tax values is not allowed. Please review the form and try again.');
  }

  return null;
}

async function withTaxSettingsActionErrors<T>(work: () => Promise<T>): Promise<T | TaxSettingsActionError> {
  try {
    return await work();
  } catch (error) {
    const expected = taxSettingsActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
}

function tenantScopedTable<Row extends object = Record<string, any>>(
  conn: Knex | Knex.Transaction,
  tenant: string,
  table: string
): Knex.QueryBuilder<Row, Row[]> {
  return tenantDb(conn, tenant).table<Row>(table);
}

export const getClientTaxSettings = withAuth(async (user, { tenant }, clientId: string): Promise<IClientTaxSettings | null | TaxSettingsActionError> => {
  try {
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const taxSettings = await tenantScopedTable<IClientTaxSettings>(trx, tenant, 'client_tax_settings')
        .where({ client_id: clientId })
        .first();

    // Removed fetching of components, thresholds, holidays based on tax_rate_id (Phase 1.2)
    // These are now associated directly with tax rates/components, not the settings record.
    // Advanced rule handling might be revisited in later phases if needed here.

      return taxSettings || null;
    });
  } catch (error) {
    const expected = taxSettingsActionErrorFrom(error);
    if (expected) return expected;
    console.error('Error fetching client tax settings:', error);
    throw error;
  }
});

export const updateClientTaxSettings = withAuth(async (
  user,
  { tenant },
  clientId: string,
  taxSettings: Omit<IClientTaxSettings, 'tenant'>
): Promise<IClientTaxSettings | null | TaxSettingsActionError> => {
  return withTaxSettingsActionErrors(async () => {
    if (!(await hasPermission(user, 'billing', 'update'))) {
      throw new Error('Permission denied: billing update required');
    }
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      // Update only the fields remaining on client_tax_settings.
      await tenantScopedTable<IClientTaxSettings>(trx, tenant, 'client_tax_settings')
        .where('client_id', clientId)
        .update({
          is_reverse_charge_applicable: taxSettings.is_reverse_charge_applicable,
          tax_source_override: taxSettings.tax_source_override ?? null,
        });

      const updatedSettings = await tenantScopedTable<IClientTaxSettings>(trx, tenant, 'client_tax_settings')
        .where('client_id', clientId)
        .first();

      if (!updatedSettings) {
        throw new Error('One or more tax settings components could not be found.');
      }

      return updatedSettings;
    });
  });
});

// Return the base ITaxRate type, which now includes description and region_code
export const getTaxRates = withAuth(async (user, { tenant }): Promise<ITaxRate[] | TaxSettingsActionError> => {
  try {
    const { knex } = await createTenantKnex();
    // Select all fields directly from tax_rates
    const taxRates = await withTransaction(knex, async (trx) => {
      return await tenantScopedTable<ITaxRate>(trx, tenant, 'tax_rates')
        .select('*') // Select all columns from tax_rates
        .where('is_active', true); // Filter for active tax rates
    });

    return taxRates;
  } catch (error) {
    const expected = taxSettingsActionErrorFrom(error);
    if (expected) return expected;
    console.error('Error fetching tax rates:', error);
    throw error;
  }
});

/**
 * Fetches all active tax regions for the current tenant.
 * @returns A promise that resolves to an array of active tax regions.
 */
export const getActiveTaxRegions = withAuth(async (user, { tenant }): Promise<Pick<ITaxRegion, 'region_code' | 'region_name'>[] | TaxSettingsActionError> => {
  try {
    const { knex } = await createTenantKnex();
    const activeRegions = await tenantScopedTable<ITaxRegion>(knex, tenant, 'tax_regions')
      .select('region_code', 'region_name')
      .where('is_active', true)
      .orderBy('region_name', 'asc');

    return activeRegions;
  } catch (error) {
    const expected = taxSettingsActionErrorFrom(error);
    if (expected) return expected;
    console.error('Error fetching active tax regions:', error);
    throw error;
  }
});

/**
 * Fetches all tax regions (active and inactive) for the current tenant.
 * @returns A promise that resolves to an array of all tax regions.
 */
export const getTaxRegions = withAuth(async (user, { tenant }): Promise<ITaxRegion[] | TaxSettingsActionError> => {
  try {
    const { knex } = await createTenantKnex();
    const regions = await tenantScopedTable<ITaxRegion>(knex, tenant, 'tax_regions')
      .select('*')
      .orderBy('region_name', 'asc');

    return regions;
  } catch (error) {
    const expected = taxSettingsActionErrorFrom(error);
    if (expected) return expected;
    console.error('Error fetching all tax regions:', error);
    throw error;
  }
});

/**
 * Creates a new tax region for the current tenant.
 * Ensures region_code uniqueness within the tenant.
 * @param data - The data for the new tax region.
 * @returns A promise that resolves to the newly created tax region.
 */
export const createTaxRegion = withAuth(async (
  user,
  { tenant },
  data: {
    region_code: string;
    region_name: string;
    is_active?: boolean;
  }
): Promise<ITaxRegion | TaxRegionActionError> => {
  if (!(await hasPermission(user, 'billing', 'create'))) {
    return permissionError('Permission denied: billing create required');
  }
  const { knex } = await createTenantKnex();
  const { region_code, region_name, is_active = true } = data; // Default is_active to true

  try {
    // Check for existing region_code within the tenant
    const existingRegion = await tenantScopedTable<ITaxRegion>(knex, tenant, 'tax_regions')
      .where('region_code', region_code)
      .first();

    if (existingRegion) {
      return actionError(`Tax region with code "${region_code}" already exists.`);
    }

    const [createdRegion] = await tenantScopedTable<ITaxRegion>(knex, tenant, 'tax_regions')
      .insert({
        region_code,
        region_name,
        is_active,
        tenant: tenant!,
      })
      .returning('*');

    return createdRegion;
  } catch (error) {
    const expected = taxSettingsActionErrorFrom(error);
    if (expected) return expected;
    console.error('Error creating tax region:', error);
    throw error;
  }
});

/**
 * Updates an existing tax region for the current tenant.
 * Can update region_name and is_active status.
 * @param region_code - The code of the tax region to update.
 * @param data - The data to update.
 * @returns A promise that resolves to the updated tax region.
 */
export const updateTaxRegion = withAuth(async (
  user,
  { tenant },
  region_code: string,
  data: { region_code?: string; region_name?: string; is_active?: boolean }
): Promise<ITaxRegion | TaxRegionActionError> => {
  try {
    if (!(await hasPermission(user, 'billing', 'update'))) {
      return permissionError('Permission denied: Cannot update tax regions');
    }

    const { knex } = await createTenantKnex();
    const updateData: Partial<Pick<ITaxRegion, 'region_code' | 'region_name' | 'is_active'>> = {};

  if (data.region_code !== undefined) {
    updateData.region_code = data.region_code;
  }
  if (data.region_name !== undefined) {
    updateData.region_name = data.region_name;
  }
  if (data.is_active !== undefined) {
    updateData.is_active = data.is_active;
  }

  // Ensure there's something to update
  if (Object.keys(updateData).length === 0) {
    // Optionally, fetch and return the existing region or throw an error
     const existingRegion = await tenantScopedTable<ITaxRegion>(knex, tenant, 'tax_regions')
      .where('region_code', region_code)
      .first();
    if (!existingRegion) {
       return actionError(`Tax region with code "${region_code}" not found.`);
    }
    return existingRegion;
    // Or: throw new Error('No update data provided.');
  }


    // If updating the region_code, check for uniqueness
    if (data.region_code !== undefined && data.region_code !== region_code) {
      const existingRegion = await tenantScopedTable<ITaxRegion>(knex, tenant, 'tax_regions')
        .where('region_code', data.region_code)
        .first();

      if (existingRegion) {
        return actionError(`Tax region with code "${data.region_code}" already exists.`);
      }
    }

    const [updatedRegion] = await tenantScopedTable<ITaxRegion>(knex, tenant, 'tax_regions')
      .where('region_code', region_code)
      .update(updateData)
      .returning('*');

    if (!updatedRegion) {
      return actionError(`Tax region with code "${region_code}" not found.`);
    }

    return updatedRegion;
  } catch (error) {
    const expected = taxSettingsActionErrorFrom(error);
    if (expected) return expected;
    console.error('Error updating tax region:', error);
    throw error;
  }
});

/**
 * Fetches all tax components for a specific tax rate.
 * @param taxRateId - The ID of the tax rate to get components for.
 * @returns A promise that resolves to an array of tax components.
 */
export const getTaxComponentsByTaxRate = withAuth(async (user, { tenant }, taxRateId: string): Promise<ITaxComponent[] | TaxSettingsActionError> => {
  try {
    const { knex } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required');
    }
    const components = await tenantScopedTable<ITaxComponent>(knex, tenant, 'tax_components')
      .where({
        tax_rate_id: taxRateId
      })
      .orderBy('sequence', 'asc');
    return components;
  } catch (error) {
    const expected = taxSettingsActionErrorFrom(error);
    if (expected) return expected;
    console.error('Error fetching tax components:', error);
    throw error;
  }
});

/**
 * Fetches all tax rate thresholds for a specific tax rate.
 * @param taxRateId - The ID of the tax rate to get thresholds for.
 * @returns A promise that resolves to an array of tax rate thresholds.
 */
export const getTaxRateThresholdsByTaxRate = withAuth(async (user, { tenant }, taxRateId: string): Promise<ITaxRateThreshold[] | TaxSettingsActionError> => {
  try {
    const { knex } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required');
    }
    const thresholds = await tenantDb(knex, tenant).parentScopedTable<ITaxRateThreshold>('tax_rate_thresholds')
      .where({ tax_rate_id: taxRateId })
      .orderBy('min_amount', 'asc');
    return thresholds;
  } catch (error) {
    const expected = taxSettingsActionErrorFrom(error);
    if (expected) return expected;
    console.error('Error fetching tax rate thresholds:', error);
    throw error;
  }
});

/**
 * Fetches all tax holidays for a specific tax rate.
 * @param taxRateId - The ID of the tax rate to get holidays for.
 * @returns A promise that resolves to an array of tax holidays.
 */
export const getTaxHolidaysByTaxRate = withAuth(async (user, { tenant }, taxRateId: string): Promise<ITaxHoliday[] | TaxSettingsActionError> => {
  try {
    const { knex } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required');
    }
    const holidays = await tenantDb(knex, tenant).parentScopedTable<ITaxHoliday>('tax_holidays')
      .where({ tax_rate_id: taxRateId })
      .orderBy('start_date', 'desc');
    return holidays;
  } catch (error) {
    const expected = taxSettingsActionErrorFrom(error);
    if (expected) return expected;
    console.error('Error fetching tax holidays:', error);
    throw error;
  }
});

export const createTaxComponent = withAuth(async (
  user,
  { tenant },
  component: Omit<ITaxComponent, 'tax_component_id' | 'tenant'>
): Promise<ITaxComponent | TaxSettingsActionError> => {
  return withTaxSettingsActionErrors(async () => {
    if (!(await hasPermission(user, 'billing', 'create'))) {
      throw new Error('Permission denied: billing create required');
    }
    const { knex } = await createTenantKnex();
    const [createdComponent] = await tenantScopedTable<ITaxComponent>(knex, tenant, 'tax_components')
      .insert({ ...component, tax_component_id: uuid4(), tenant: tenant! })
      .returning('*');

    return createdComponent;
  });
});


export const updateTaxComponent = withAuth(async (
  user,
  { tenant },
  componentId: string,
  component: Partial<ITaxComponent>
): Promise<ITaxComponent | TaxSettingsActionError> => {
  return withTaxSettingsActionErrors(async () => {
    if (!(await hasPermission(user, 'billing', 'update'))) {
      throw new Error('Permission denied: billing update required');
    }
    const { knex } = await createTenantKnex();
    const [updatedComponent] = await tenantScopedTable<ITaxComponent>(knex, tenant, 'tax_components')
      .where({ tax_component_id: componentId })
      .update(component)
      .returning('*');

    if (!updatedComponent) throw new Error('Tax component not found');

    return updatedComponent;
  });
});

export const deleteTaxComponent = withAuth(async (user, { tenant }, componentId: string): Promise<void | TaxSettingsActionError> => {
  return withTaxSettingsActionErrors(async () => {
    if (!(await hasPermission(user, 'billing', 'delete'))) {
      throw new Error('Permission denied: billing delete required');
    }
    const { knex } = await createTenantKnex();
    const deleted = await tenantScopedTable(knex, tenant, 'tax_components')
      .where({ tax_component_id: componentId })
      .del();
    if (deleted === 0) throw new Error('Tax component not found');
  });
});

export const createTaxRateThreshold = withAuth(async (
  user,
  { tenant },
  threshold: Omit<ITaxRateThreshold, 'tax_rate_threshold_id'>
): Promise<ITaxRateThreshold | TaxSettingsActionError> => {
  return withTaxSettingsActionErrors(async () => {
    if (!(await hasPermission(user, 'billing', 'create'))) {
      throw new Error('Permission denied: billing create required');
    }
    const { knex } = await createTenantKnex();
    const [createdThreshold] = await tenantDb(knex, tenant).insertParentScoped<ITaxRateThreshold>(
      'tax_rate_thresholds',
      { ...threshold, tax_rate_threshold_id: uuid4() }
    );

    return createdThreshold;
  });
});

export const updateTaxRateThreshold = withAuth(async (
  user,
  { tenant },
  thresholdId: string,
  threshold: Partial<ITaxRateThreshold>
): Promise<ITaxRateThreshold | TaxSettingsActionError> => {
  return withTaxSettingsActionErrors(async () => {
    if (!(await hasPermission(user, 'billing', 'update'))) {
      throw new Error('Permission denied: billing update required');
    }
    const { knex } = await createTenantKnex();
    const thresholdPatch = { ...threshold };
    delete thresholdPatch.tax_rate_id;
    const [updatedThreshold] = await tenantDb(knex, tenant).parentScopedTable<ITaxRateThreshold>('tax_rate_thresholds')
      .where({ tax_rate_threshold_id: thresholdId })
      .update(thresholdPatch)
      .returning('*');

    if (!updatedThreshold) throw new Error('Tax threshold not found');

    return updatedThreshold;
  });
});

export const deleteTaxRateThreshold = withAuth(async (user, { tenant }, thresholdId: string): Promise<void | TaxSettingsActionError> => {
  return withTaxSettingsActionErrors(async () => {
    if (!(await hasPermission(user, 'billing', 'delete'))) {
      throw new Error('Permission denied: billing delete required');
    }
    const { knex } = await createTenantKnex();
    const deleted = await tenantDb(knex, tenant).parentScopedTable('tax_rate_thresholds')
      .where({ tax_rate_threshold_id: thresholdId })
      .del();
    if (deleted === 0) throw new Error('Tax threshold not found');
  });
});

export const createTaxHoliday = withAuth(async (
  user,
  { tenant },
  holiday: Omit<ITaxHoliday, 'tax_holiday_id'>
): Promise<ITaxHoliday | TaxSettingsActionError> => {
  return withTaxSettingsActionErrors(async () => {
    if (!(await hasPermission(user, 'billing', 'create'))) {
      throw new Error('Permission denied: billing create required');
    }
    const { knex } = await createTenantKnex();
    const [createdHoliday] = await tenantDb(knex, tenant).insertParentScoped<ITaxHoliday>(
      'tax_holidays',
      { ...holiday, tax_holiday_id: uuid4() }
    );

    return createdHoliday;
  });
});

export const updateTaxHoliday = withAuth(async (
  user,
  { tenant },
  holidayId: string,
  holiday: Partial<ITaxHoliday>
): Promise<ITaxHoliday | TaxSettingsActionError> => {
  return withTaxSettingsActionErrors(async () => {
    if (!(await hasPermission(user, 'billing', 'update'))) {
      throw new Error('Permission denied: billing update required');
    }
    const { knex } = await createTenantKnex();
    const holidayPatch = { ...holiday };
    delete holidayPatch.tax_rate_id;
    const [updatedHoliday] = await tenantDb(knex, tenant).parentScopedTable<ITaxHoliday>('tax_holidays')
      .where({ tax_holiday_id: holidayId })
      .update(holidayPatch)
      .returning('*');

    if (!updatedHoliday) throw new Error('Tax holiday not found');

    return updatedHoliday;
  });
});

export const deleteTaxHoliday = withAuth(async (user, { tenant }, holidayId: string): Promise<void | TaxSettingsActionError> => {
  return withTaxSettingsActionErrors(async () => {
    if (!(await hasPermission(user, 'billing', 'delete'))) {
      throw new Error('Permission denied: billing delete required');
    }
    const { knex } = await createTenantKnex();
    const deleted = await tenantDb(knex, tenant).parentScopedTable('tax_holidays')
      .where({ tax_holiday_id: holidayId })
      .del();
    if (deleted === 0) throw new Error('Tax holiday not found');
  });
});

// Internal helper for server-side client creation paths. Keep exception semantics here
// so callers can decide whether default-tax setup is best-effort.
export async function createDefaultTaxSettingsInternal(clientId: string): Promise<IClientTaxSettings> {
  const taxService = new TaxService();
  return taxService.createDefaultTaxSettings(clientId);
}

export const createDefaultTaxSettings = withAuth(async (
  user,
  { tenant },
  clientId: string
): Promise<IClientTaxSettings | TaxSettingsActionError> => {
  return withTaxSettingsActionErrors(async () => {
    if (!(await hasPermission(user, 'billing', 'update'))) {
      throw new Error('Permission denied: billing update required');
    }
    const { knex } = await createTenantKnex();
    const defaultTaxRate = await tenantScopedTable<ITaxRate>(knex, tenant, 'tax_rates')
      .where('is_active', true)
      .first();
    if (!defaultTaxRate) {
      throw new Error('No active tax rates found in the system to assign as default.');
    }
    return createDefaultTaxSettingsInternal(clientId);
  });
});

/**
 * Updates a client's tax exempt status with audit logging.
 * @param clientId - The ID of the client to update.
 * @param isTaxExempt - The new tax exempt status.
 * @param taxExemptionCertificate - Optional tax exemption certificate number.
 * @returns A promise that resolves to the updated client's tax exempt status.
 */
export const updateClientTaxExemptStatus = withAuth(async (
  user,
  { tenant },
  clientId: string,
  isTaxExempt: boolean,
  taxExemptionCertificate?: string
): Promise<{ is_tax_exempt: boolean; tax_exemption_certificate?: string } | TaxSettingsActionError> => {
  return withTaxSettingsActionErrors(async () => {
    if (!(await hasPermission(user, 'client', 'update'))) {
      throw new Error('Permission denied: Cannot update client tax settings');
    }

    const { knex } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required');
    }

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      // Get current status for audit log
      const currentClient = await tenantScopedTable(trx, tenant, 'clients')
        .where({ client_id: clientId })
        .select('is_tax_exempt', 'tax_exemption_certificate')
        .first();

      if (!currentClient) {
        throw new Error('Client not found');
      }

      const updateData: { is_tax_exempt: boolean; tax_exemption_certificate?: string } = {
        is_tax_exempt: isTaxExempt
      };

      // Only update certificate if provided, or clear it if exempt is turned off
      if (taxExemptionCertificate !== undefined) {
        updateData.tax_exemption_certificate = taxExemptionCertificate;
      } else if (!isTaxExempt) {
        // Clear certificate when turning off tax exempt
        updateData.tax_exemption_certificate = '';
      }

      // Update the client
      await tenantScopedTable(trx, tenant, 'clients')
        .where({ client_id: clientId })
        .update(updateData);

      // Create audit log entry for tax exempt status change
      const { auditLog } = await import('@alga-psa/db');
      await auditLog(trx, {
        userId: user.user_id,
        operation: 'UPDATE',
        tableName: 'clients',
        recordId: clientId,
        changedData: {
          is_tax_exempt: {
            from: currentClient.is_tax_exempt,
            to: isTaxExempt
          },
          ...(taxExemptionCertificate !== undefined && {
            tax_exemption_certificate: {
              from: currentClient.tax_exemption_certificate,
              to: taxExemptionCertificate
            }
          })
        },
        details: {
          action: 'TAX_EXEMPT_STATUS_CHANGE',
          client_id: clientId,
          previous_status: currentClient.is_tax_exempt,
          new_status: isTaxExempt
        }
      });

      return updateData;
    });
  });
});

/**
 * Fetches a client's current tax exempt status.
 * @param clientId - The ID of the client.
 * @returns A promise that resolves to the client's tax exempt info.
 */
export const getClientTaxExemptStatus = withAuth(async (
  user,
  { tenant },
  clientId: string
): Promise<{ is_tax_exempt: boolean; tax_exemption_certificate?: string } | null | TaxSettingsActionError> => {
  try {
    const { knex } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required');
    }

    const client = await tenantScopedTable(knex, tenant, 'clients')
      .where({ client_id: clientId })
      .select('is_tax_exempt', 'tax_exemption_certificate')
      .first();

    if (!client) {
      return null;
    }

    return {
      is_tax_exempt: client.is_tax_exempt ?? false,
      tax_exemption_certificate: client.tax_exemption_certificate
    };
  } catch (error) {
    const expected = taxSettingsActionErrorFrom(error);
    if (expected) return expected;
    console.error('Error fetching client tax exempt status:', error);
    throw error;
  }
});

/**
 * Fetches tenant-level tax source settings.
 * Note: The accounting adapter is determined automatically based on which system
 * the invoice is exported to, not configured in settings.
 * @returns A promise that resolves to the tenant tax settings.
 */
export const getTenantTaxSettings = withAuth(async (user, { tenant }): Promise<{
  default_tax_source: 'internal' | 'external' | 'pending_external';
  allow_external_tax_override: boolean;
} | null | TaxSettingsActionError> => {
  try {
    if (!tenant) {
      throw new Error('SYSTEM_ERROR: Tenant context not found');
    }

    const { knex } = await createTenantKnex();

    const settings = await tenantScopedTable(knex, tenant, 'tenant_settings')
      .select('default_tax_source', 'allow_external_tax_override')
      .first();

    if (!settings) {
      // Return defaults if no settings row exists
      return {
        default_tax_source: 'internal',
        allow_external_tax_override: false,
      };
    }

    return {
      default_tax_source: settings.default_tax_source || 'internal',
      allow_external_tax_override: settings.allow_external_tax_override ?? false,
    };
  } catch (error) {
    const expected = taxSettingsActionErrorFrom(error);
    if (expected) return expected;
    console.error('Error fetching tenant tax settings:', error);
    throw error;
  }
});

/**
 * Updates tenant-level tax source settings.
 * Note: The accounting adapter is determined automatically based on which system
 * the invoice is exported to, not configured here.
 * @param settings - The settings to update.
 * @returns A promise that resolves when the settings are updated.
 */
export const updateTenantTaxSettings = withAuth(async (
  user,
  { tenant },
  settings: {
    default_tax_source: 'internal' | 'external' | 'pending_external';
    allow_external_tax_override: boolean;
  }
): Promise<void | TaxSettingsActionError> => {
  return withTaxSettingsActionErrors(async () => {
    if (!(await hasPermission(user, 'billing', 'update'))) {
      throw new Error('Permission denied: Cannot update tenant tax settings');
    }

    if (!tenant) {
      throw new Error('SYSTEM_ERROR: Tenant context not found');
    }

    const { knex } = await createTenantKnex();

    const updateData = {
      default_tax_source: settings.default_tax_source,
      allow_external_tax_override: settings.allow_external_tax_override,
    };

    // Try to update existing row, or insert if not exists
    const existingSettings = await tenantScopedTable(knex, tenant, 'tenant_settings')
      .first();

    if (existingSettings) {
      await tenantScopedTable(knex, tenant, 'tenant_settings')
        .update(updateData);
    } else {
      await tenantScopedTable(knex, tenant, 'tenant_settings')
        .insert({
          tenant,
          ...updateData,
        });
    }
  });
});

const DELEGATION_INTEGRATION_TYPES = ['xero', 'quickbooks_online'] as const;
const INTEGRATION_LABELS: Record<string, string> = {
  xero: 'Xero',
  quickbooks_online: 'QuickBooks Online',
};

/**
 * Returns whether the in-settings "let your accounting system calculate tax" banner
 * should appear for the current tenant, plus the label of the first delegation-capable
 * adapter that has an active mapping. The banner appears when:
 * - `default_tax_source` is `internal`
 * - The tenant admin hasn't dismissed the banner
 * - At least one live-adapter mapping (Xero / QBO Online) exists
 */
export const getTaxDelegationNudgeState = withAuth(async (
  _user,
  { tenant }
): Promise<{ shouldShow: boolean; adapterLabel: string | null }> => {
  if (!tenant) {
    return { shouldShow: false, adapterLabel: null };
  }

  const { knex } = await createTenantKnex();

  const settings = await tenantScopedTable(knex, tenant, 'tenant_settings')
    .select('default_tax_source', 'tax_delegation_nudge_dismissed_at')
    .first();

  if (settings?.tax_delegation_nudge_dismissed_at) {
    return { shouldShow: false, adapterLabel: null };
  }
  if ((settings?.default_tax_source ?? 'internal') !== 'internal') {
    return { shouldShow: false, adapterLabel: null };
  }

  const mapping = await tenantScopedTable(knex, tenant, 'tenant_external_entity_mappings')
    .whereIn('integration_type', DELEGATION_INTEGRATION_TYPES as unknown as string[])
    .select('integration_type')
    .first();

  if (!mapping) {
    return { shouldShow: false, adapterLabel: null };
  }

  return {
    shouldShow: true,
    adapterLabel: INTEGRATION_LABELS[mapping.integration_type] ?? 'your accounting system',
  };
});

/**
 * Marks the tax delegation banner as dismissed for the current tenant. Dismissal is
 * tenant-wide by design — one admin's dismissal suppresses the banner for the rest
 * of the tenant.
 */
export const dismissTaxDelegationNudge = withAuth(async (
  user,
  { tenant }
): Promise<void | TaxSettingsActionError> => {
  return withTaxSettingsActionErrors(async () => {
    if (!(await hasPermission(user, 'billing', 'update'))) {
      throw new Error('Permission denied: Cannot dismiss tax delegation banner');
    }
    if (!tenant) {
      throw new Error('SYSTEM_ERROR: Tenant context not found');
    }

    const { knex } = await createTenantKnex();
    const now = new Date().toISOString();

    const existing = await tenantScopedTable(knex, tenant, 'tenant_settings').first();
    if (existing) {
      await tenantScopedTable(knex, tenant, 'tenant_settings')
        .update({ tax_delegation_nudge_dismissed_at: now });
    } else {
      await tenantScopedTable(knex, tenant, 'tenant_settings').insert({
        tenant,
        tax_delegation_nudge_dismissed_at: now,
      });
    }
  });
});
