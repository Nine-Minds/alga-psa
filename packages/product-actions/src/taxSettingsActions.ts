'use server'

import { withTransaction } from '@alga-psa/shared/db';
import { IClientTaxSettings, ITaxRate, ITaxComponent, ITaxRateThreshold, ITaxHoliday } from 'server/src/interfaces/tax.interfaces';
import { v4 as uuid4 } from 'uuid';
import { TaxService } from '@server/lib/services/taxService';
import { ITaxRegion } from 'server/src/interfaces/tax.interfaces';
import { createTenantKnex } from '@server/lib/db';
import { Knex } from 'knex';
import { getCurrentUser } from '@product/actions/user-actions/userActions';
import { hasPermission } from '@server/lib/auth/rbac';
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
    const taxRates = await knex<ITaxRate>('tax_rates')
      .select('*') // Select all columns from tax_rates
      .where('is_active', true) // Filter for active tax rates
      .andWhere('tenant', tenant); // Filter tax rates by tenant

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

export async function createTaxComponent(component: Omit<ITaxComponent, 'tax_component_id' | 'tenant'>): Promise<ITaxComponent> {
  try {
    const { knex, tenant } = await createTenantKnex();
    const [createdComponent] = await knex<ITaxComponent>('tax_components')
      .insert({ ...component, tenant: tenant! })
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
      .insert(threshold)
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
      .insert(holiday)
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
