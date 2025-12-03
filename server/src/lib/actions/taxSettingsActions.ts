'use server'

import { withTransaction } from '@alga-psa/shared/db';
import { IClientTaxSettings, ITaxRate, ITaxComponent, ITaxRateThreshold, ITaxHoliday } from 'server/src/interfaces/tax.interfaces';
import { v4 as uuid4 } from 'uuid';
import { TaxService } from 'server/src/lib/services/taxService';
import { ITaxRegion } from 'server/src/interfaces/tax.interfaces';
import { createTenantKnex } from 'server/src/lib/db';
import { Knex } from 'knex';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { hasPermission } from 'server/src/lib/auth/rbac';
export async function getClientTaxSettings(clientId: string): Promise<IClientTaxSettings | null> {
  try {
    const { knex: db, tenant } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const taxSettings = await trx<IClientTaxSettings>('client_tax_settings')
        .where({ client_id: clientId })
        .first();

    // Removed fetching of components, thresholds, holidays based on tax_rate_id (Phase 1.2)
    // These are now associated directly with tax rates/components, not the settings record.
    // Advanced rule handling might be revisited in later phases if needed here.

      return taxSettings || null;
    });
  } catch (error) {
    console.error('Error fetching client tax settings:', error);
    if (error instanceof Error) {
      throw new Error(`Failed to fetch client tax settings: ${error.message}`);
    } else {
      throw new Error('Failed to fetch client tax settings due to an unexpected error.');
    }
  }
}

export async function updateClientTaxSettings(
  clientId: string,
  taxSettings: Omit<IClientTaxSettings, 'tenant'>
): Promise<IClientTaxSettings | null> {
  const { knex: db, tenant } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
    // Update only the fields remaining on client_tax_settings
    await trx<IClientTaxSettings>('client_tax_settings')
      .where('client_id', clientId) // Separate where clauses
      .andWhere('tenant', tenant!)     // Use non-null assertion for tenant
      .update({
        // tax_rate_id: taxSettings.tax_rate_id, // Removed field
        is_reverse_charge_applicable: taxSettings.is_reverse_charge_applicable,
        tax_source_override: taxSettings.tax_source_override ?? null,
        // Note: tax_components, tax_rate_thresholds, tax_holidays are no longer managed
        // directly through this settings update based on tax_rate_id.
        // Their management is tied to specific tax rates/components now.
      });
        // Removed transaction logic for components, thresholds, holidays (Phase 1.2)

        return await getClientTaxSettings(clientId);
      } catch (error) {
        console.error('Error updating client tax settings:', error);
      
      // Enhanced error messages with more specific information
      if (error instanceof Error) {
        if (error.message.includes('foreign key constraint')) {
          throw new Error('Invalid tax rate or component reference. Please check your selections.');
        } else if (error.message.includes('duplicate key')) {
          throw new Error('Duplicate entry detected. Please check your tax components or thresholds.');
        } else if (error.message.includes('not found')) {
          throw new Error('One or more tax settings components could not be found.');
        } else {
          throw new Error(`Failed to update client tax settings: ${error.message}`);
        }
        } else {
          throw new Error('Failed to update client tax settings due to an unexpected error.');
        }
      }
  });
}

// Return the base ITaxRate type, which now includes description and region_code
export async function getTaxRates(): Promise<ITaxRate[]> {
  try {
    const { knex, tenant } = await createTenantKnex(); // Get tenant for filtering
    // Select all fields directly from tax_rates
    const taxRates = await withTransaction(knex, async (trx) => {
      return await trx<ITaxRate>('tax_rates')
        .select('*') // Select all columns from tax_rates
        .where('is_active', true) // Filter for active tax rates
        .andWhere('tenant', tenant); // Filter tax rates by tenant
    });

    return taxRates;
  } catch (error) {
    console.error('Error fetching tax rates:', error);
    if (error instanceof Error) {
      throw new Error(`Failed to fetch tax rates: ${error.message}`);
    } else {
      throw new Error('Failed to fetch tax rates due to an unexpected error.');
    }
  }
}

/**
 * Fetches all active tax regions for the current tenant.
 * @returns A promise that resolves to an array of active tax regions.
 */
export async function getActiveTaxRegions(): Promise<Pick<ITaxRegion, 'region_code' | 'region_name'>[]> {
  try {
    const { knex, tenant } = await createTenantKnex();
    const activeRegions = await knex<ITaxRegion>('tax_regions')
      .select('region_code', 'region_name')
      .where('is_active', true)
      .where('tenant', tenant)
      .orderBy('region_name', 'asc');

    return activeRegions;
  } catch (error) {
    console.error('Error fetching active tax regions:', error);
    if (error instanceof Error) {
      throw new Error(`Failed to fetch active tax regions: ${error.message}`);
    } else {
      throw new Error('Failed to fetch active tax regions due to an unexpected error.');
    }
  }
}

/**
 * Fetches all tax regions (active and inactive) for the current tenant.
 * @returns A promise that resolves to an array of all tax regions.
 */
export async function getTaxRegions(): Promise<ITaxRegion[]> {
  try {
    const { knex, tenant } = await createTenantKnex();
    const regions = await knex<ITaxRegion>('tax_regions')
      .select('*')
      .where('tenant', tenant)
      .orderBy('region_name', 'asc');

    return regions;
  } catch (error) {
    console.error('Error fetching all tax regions:', error);
    if (error instanceof Error) {
      throw new Error(`Failed to fetch tax regions: ${error.message}`);
    } else {
      throw new Error('Failed to fetch tax regions due to an unexpected error.');
    }
  }
}

/**
 * Creates a new tax region for the current tenant.
 * Ensures region_code uniqueness within the tenant.
 * @param data - The data for the new tax region.
 * @returns A promise that resolves to the newly created tax region.
 */
export async function createTaxRegion(data: {
  region_code: string;
  region_name: string;
  is_active?: boolean;
}): Promise<ITaxRegion> {
  const { knex, tenant } = await createTenantKnex();
  const { region_code, region_name, is_active = true } = data; // Default is_active to true

  try {
    // Check for existing region_code within the tenant
    const existingRegion = await knex<ITaxRegion>('tax_regions')
      .where('tenant', tenant)
      .andWhere('region_code', region_code)
      .first();

    if (existingRegion) {
      throw new Error(`Tax region with code "${region_code}" already exists.`);
    }

    const [createdRegion] = await knex<ITaxRegion>('tax_regions')
      .insert({
        region_code,
        region_name,
        is_active,
        tenant: tenant!,
      })
      .returning('*');

    return createdRegion;
  } catch (error) {
    console.error('Error creating tax region:', error);
    if (error instanceof Error) {
      // Re-throw specific errors or a generic one
      if (error.message.includes('already exists')) {
        throw error; // Re-throw the specific uniqueness error
      }
      throw new Error(`Failed to create tax region: ${error.message}`);
    } else {
      throw new Error('Failed to create tax region due to an unexpected error.');
    }
  }
}

/**
 * Updates an existing tax region for the current tenant.
 * Can update region_name and is_active status.
 * @param region_code - The code of the tax region to update.
 * @param data - The data to update.
 * @returns A promise that resolves to the updated tax region.
 */
export async function updateTaxRegion(
  region_code: string,
  data: { region_code?: string; region_name?: string; is_active?: boolean }
): Promise<ITaxRegion> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('No authenticated user found');
    }

    if (!(await hasPermission(currentUser, 'billing', 'update'))) {
      throw new Error('Permission denied: Cannot update tax regions');
    }

    const { knex, tenant } = await createTenantKnex();
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
     const existingRegion = await knex<ITaxRegion>('tax_regions')
      .where('tenant', tenant)
      .andWhere('region_code', region_code)
      .first();
    if (!existingRegion) {
       throw new Error(`Tax region with code "${region_code}" not found.`);
    }
    return existingRegion;
    // Or: throw new Error('No update data provided.');
  }


    // If updating the region_code, check for uniqueness
    if (data.region_code !== undefined && data.region_code !== region_code) {
      const existingRegion = await knex<ITaxRegion>('tax_regions')
        .where('tenant', tenant)
        .andWhere('region_code', data.region_code)
        .first();

      if (existingRegion) {
        throw new Error(`Tax region with code "${data.region_code}" already exists.`);
      }
    }

    const [updatedRegion] = await knex<ITaxRegion>('tax_regions')
      .where('tenant', tenant)
      .andWhere('region_code', region_code)
      .update(updateData)
      .returning('*');

    if (!updatedRegion) {
      throw new Error(`Tax region with code "${region_code}" not found.`);
    }

    return updatedRegion;
  } catch (error) {
    console.error('Error updating tax region:', error);
    if (error instanceof Error) {
      if (error.message.includes('not found')) {
        throw error; // Re-throw the specific not found error
      }
      if (error.message.includes('Permission denied')) {
        throw error; // Re-throw permission errors
      }
      throw new Error(`Failed to update tax region: ${error.message}`);
    } else {
      throw new Error('Failed to update tax region due to an unexpected error.');
    }
  }
}

/**
 * Fetches all tax components for a specific tax rate.
 * @param taxRateId - The ID of the tax rate to get components for.
 * @returns A promise that resolves to an array of tax components.
 */
export async function getTaxComponentsByTaxRate(taxRateId: string): Promise<ITaxComponent[]> {
  try {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required');
    }
    const components = await knex<ITaxComponent>('tax_components')
      .where({
        tax_rate_id: taxRateId,
        tenant
      })
      .orderBy('sequence', 'asc');
    return components;
  } catch (error) {
    console.error('Error fetching tax components:', error);
    if (error instanceof Error) {
      throw new Error(`Failed to fetch tax components: ${error.message}`);
    }
    throw new Error('Failed to fetch tax components');
  }
}

/**
 * Fetches all tax rate thresholds for a specific tax rate.
 * @param taxRateId - The ID of the tax rate to get thresholds for.
 * @returns A promise that resolves to an array of tax rate thresholds.
 */
export async function getTaxRateThresholdsByTaxRate(taxRateId: string): Promise<ITaxRateThreshold[]> {
  try {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required');
    }
    // Note: tax_rate_thresholds table doesn't have tenant column, RLS enforced via tax_rate_id
    const thresholds = await knex<ITaxRateThreshold>('tax_rate_thresholds')
      .where({ tax_rate_id: taxRateId })
      .orderBy('min_amount', 'asc');
    return thresholds;
  } catch (error) {
    console.error('Error fetching tax rate thresholds:', error);
    if (error instanceof Error) {
      throw new Error(`Failed to fetch tax rate thresholds: ${error.message}`);
    }
    throw new Error('Failed to fetch tax rate thresholds');
  }
}

/**
 * Fetches all tax holidays for a specific tax rate.
 * @param taxRateId - The ID of the tax rate to get holidays for.
 * @returns A promise that resolves to an array of tax holidays.
 */
export async function getTaxHolidaysByTaxRate(taxRateId: string): Promise<ITaxHoliday[]> {
  try {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required');
    }
    // Note: tax_holidays table doesn't have tenant column, RLS enforced via tax_rate_id
    const holidays = await knex<ITaxHoliday>('tax_holidays')
      .where({ tax_rate_id: taxRateId })
      .orderBy('start_date', 'desc');
    return holidays;
  } catch (error) {
    console.error('Error fetching tax holidays:', error);
    if (error instanceof Error) {
      throw new Error(`Failed to fetch tax holidays: ${error.message}`);
    }
    throw new Error('Failed to fetch tax holidays');
  }
}

export async function createTaxComponent(component: Omit<ITaxComponent, 'tax_component_id' | 'tenant'>): Promise<ITaxComponent> {
  try {
    const { knex, tenant } = await createTenantKnex();
    const [createdComponent] = await knex<ITaxComponent>('tax_components')
      .insert({ ...component, tax_component_id: uuid4(), tenant: tenant! })
      .returning('*');

    return createdComponent;
  } catch (error) {
    console.error('Error creating tax component:', error);
    throw new Error('Failed to create tax component');
  }
}


export async function updateTaxComponent(componentId: string, component: Partial<ITaxComponent>): Promise<ITaxComponent> {
  try {
    const { knex } = await createTenantKnex();
    const [updatedComponent] = await knex<ITaxComponent>('tax_components')
      .where({ tax_component_id: componentId })
      .update(component)
      .returning('*');

    return updatedComponent;
  } catch (error) {
    console.error('Error updating tax component:', error);
    throw new Error('Failed to update tax component');
  }
}

export async function deleteTaxComponent(componentId: string): Promise<void> {
  try {
    const { knex } = await createTenantKnex();
    await knex('tax_components')
      .where({ tax_component_id: componentId })
      .del();
  } catch (error) {
    console.error('Error deleting tax component:', error);
    throw new Error('Failed to delete tax component');
  }
}

export async function createTaxRateThreshold(threshold: Omit<ITaxRateThreshold, 'tax_rate_threshold_id'>): Promise<ITaxRateThreshold> {
  try {
    const { knex } = await createTenantKnex();
    const [createdThreshold] = await knex<ITaxRateThreshold>('tax_rate_thresholds')
      .insert({ ...threshold, tax_rate_threshold_id: uuid4() })
      .returning('*');

    return createdThreshold;
  } catch (error) {
    console.error('Error creating tax rate threshold:', error);
    throw new Error('Failed to create tax rate threshold');
  }
}

export async function updateTaxRateThreshold(thresholdId: string, threshold: Partial<ITaxRateThreshold>): Promise<ITaxRateThreshold> {
  try {
    const { knex } = await createTenantKnex();
    const [updatedThreshold] = await knex<ITaxRateThreshold>('tax_rate_thresholds')
      .where({ tax_rate_threshold_id: thresholdId })
      .update(threshold)
      .returning('*');

    return updatedThreshold;
  } catch (error) {
    console.error('Error updating tax rate threshold:', error);
    throw new Error('Failed to update tax rate threshold');
  }
}

export async function deleteTaxRateThreshold(thresholdId: string): Promise<void> {
  try {
    const { knex } = await createTenantKnex();
    await knex('tax_rate_thresholds')
      .where({ tax_rate_threshold_id: thresholdId })
      .del();
  } catch (error) {
    console.error('Error deleting tax rate threshold:', error);
    throw new Error('Failed to delete tax rate threshold');
  }
}

export async function createTaxHoliday(holiday: Omit<ITaxHoliday, 'tax_holiday_id'>): Promise<ITaxHoliday> {
  try {
    const { knex } = await createTenantKnex();
    const [createdHoliday] = await knex<ITaxHoliday>('tax_holidays')
      .insert({ ...holiday, tax_holiday_id: uuid4() })
      .returning('*');

    return createdHoliday;
  } catch (error) {
    console.error('Error creating tax holiday:', error);
    throw new Error('Failed to create tax holiday');
  }
}

export async function updateTaxHoliday(holidayId: string, holiday: Partial<ITaxHoliday>): Promise<ITaxHoliday> {
  try {
    const { knex } = await createTenantKnex();
    const [updatedHoliday] = await knex<ITaxHoliday>('tax_holidays')
      .where({ tax_holiday_id: holidayId })
      .update(holiday)
      .returning('*');

    return updatedHoliday;
  } catch (error) {
    console.error('Error updating tax holiday:', error);
    throw new Error('Failed to update tax holiday');
  }
}

export async function deleteTaxHoliday(holidayId: string): Promise<void> {
  try {
    const { knex } = await createTenantKnex();
    await knex('tax_holidays')
      .where({ tax_holiday_id: holidayId })
      .del();
  } catch (error) {
    console.error('Error deleting tax holiday:', error);
    throw new Error('Failed to delete tax holiday');
  }
}

export async function createDefaultTaxSettings(clientId: string): Promise<IClientTaxSettings> {
  const taxService = new TaxService();
  return taxService.createDefaultTaxSettings(clientId);
}

/**
 * Updates a client's tax exempt status with audit logging.
 * @param clientId - The ID of the client to update.
 * @param isTaxExempt - The new tax exempt status.
 * @param taxExemptionCertificate - Optional tax exemption certificate number.
 * @returns A promise that resolves to the updated client's tax exempt status.
 */
export async function updateClientTaxExemptStatus(
  clientId: string,
  isTaxExempt: boolean,
  taxExemptionCertificate?: string
): Promise<{ is_tax_exempt: boolean; tax_exemption_certificate?: string }> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('No authenticated user found');
    }

    if (!(await hasPermission(currentUser, 'client', 'update'))) {
      throw new Error('Permission denied: Cannot update client tax settings');
    }

    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required');
    }

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      // Get current status for audit log
      const currentClient = await trx('clients')
        .where({ client_id: clientId, tenant })
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
      await trx('clients')
        .where({ client_id: clientId, tenant })
        .update(updateData);

      // Create audit log entry for tax exempt status change
      const { auditLog } = await import('server/src/lib/logging/auditLog');
      await auditLog(trx, {
        userId: currentUser.user_id,
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
  } catch (error) {
    console.error('Error updating client tax exempt status:', error);
    if (error instanceof Error) {
      throw new Error(`Failed to update tax exempt status: ${error.message}`);
    }
    throw new Error('Failed to update tax exempt status');
  }
}

/**
 * Fetches a client's current tax exempt status.
 * @param clientId - The ID of the client.
 * @returns A promise that resolves to the client's tax exempt info.
 */
export async function getClientTaxExemptStatus(
  clientId: string
): Promise<{ is_tax_exempt: boolean; tax_exemption_certificate?: string } | null> {
  try {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required');
    }

    const client = await knex('clients')
      .where({ client_id: clientId, tenant })
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
    console.error('Error fetching client tax exempt status:', error);
    if (error instanceof Error) {
      throw new Error(`Failed to fetch tax exempt status: ${error.message}`);
    }
    throw new Error('Failed to fetch tax exempt status');
  }
}

/**
 * Fetches tenant-level tax source settings.
 * Note: The accounting adapter is determined automatically based on which system
 * the invoice is exported to, not configured in settings.
 * @returns A promise that resolves to the tenant tax settings.
 */
export async function getTenantTaxSettings(): Promise<{
  default_tax_source: 'internal' | 'external' | 'pending_external';
  allow_external_tax_override: boolean;
} | null> {
  try {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required');
    }

    const settings = await knex('tenant_settings')
      .where({ tenant })
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
    console.error('Error fetching tenant tax settings:', error);
    if (error instanceof Error) {
      throw new Error(`Failed to fetch tenant tax settings: ${error.message}`);
    }
    throw new Error('Failed to fetch tenant tax settings');
  }
}

/**
 * Updates tenant-level tax source settings.
 * Note: The accounting adapter is determined automatically based on which system
 * the invoice is exported to, not configured here.
 * @param settings - The settings to update.
 * @returns A promise that resolves when the settings are updated.
 */
export async function updateTenantTaxSettings(settings: {
  default_tax_source: 'internal' | 'external' | 'pending_external';
  allow_external_tax_override: boolean;
}): Promise<void> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('No authenticated user found');
    }

    if (!(await hasPermission(currentUser, 'billing', 'update'))) {
      throw new Error('Permission denied: Cannot update tenant tax settings');
    }

    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required');
    }

    const updateData = {
      default_tax_source: settings.default_tax_source,
      allow_external_tax_override: settings.allow_external_tax_override,
    };

    // Try to update existing row, or insert if not exists
    const existingSettings = await knex('tenant_settings')
      .where({ tenant })
      .first();

    if (existingSettings) {
      await knex('tenant_settings')
        .where({ tenant })
        .update(updateData);
    } else {
      await knex('tenant_settings')
        .insert({
          tenant,
          ...updateData,
        });
    }
  } catch (error) {
    console.error('Error updating tenant tax settings:', error);
    if (error instanceof Error) {
      throw new Error(`Failed to update tenant tax settings: ${error.message}`);
    }
    throw new Error('Failed to update tenant tax settings');
  }
}
