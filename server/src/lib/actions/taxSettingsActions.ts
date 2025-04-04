'use server'

import { createTenantKnex } from 'server/src/lib/db';
import { ICompanyTaxSettings, ITaxRate, ITaxComponent, ITaxRateThreshold, ITaxHoliday } from 'server/src/interfaces/tax.interfaces';
import { v4 as uuid4 } from 'uuid';
import { TaxService } from 'server/src/lib/services/taxService';

export async function getCompanyTaxSettings(companyId: string): Promise<ICompanyTaxSettings | null> {
  try {
    const { knex } = await createTenantKnex();
    const taxSettings = await knex<ICompanyTaxSettings>('company_tax_settings')
      .where({ company_id: companyId })
      .first();

    if (taxSettings) {
      taxSettings.tax_components = await knex<ITaxComponent>('tax_components')
        .where('tax_rate_id', taxSettings.tax_rate_id);

      taxSettings.tax_rate_thresholds = await knex<ITaxRateThreshold>('tax_rate_thresholds')
        .where('tax_rate_id', taxSettings.tax_rate_id);

      taxSettings.tax_holidays = await knex<ITaxHoliday>('tax_holidays')
        .where('tax_rate_id', taxSettings.tax_rate_id);
    }

    return taxSettings || null;
  } catch (error) {
    console.error('Error fetching company tax settings:', error);
    if (error instanceof Error) {
      throw new Error(`Failed to fetch company tax settings: ${error.message}`);
    } else {
      throw new Error('Failed to fetch company tax settings due to an unexpected error.');
    }
  }
}

export async function updateCompanyTaxSettings(
  companyId: string,
  taxSettings: Omit<ICompanyTaxSettings, 'tenant'>
): Promise<ICompanyTaxSettings | null> {
  const { knex, tenant } = await createTenantKnex();
  const trx = await knex.transaction();

  try {
    await trx<ICompanyTaxSettings>('company_tax_settings')
      .where({ company_id: companyId })
      .update({
        tax_rate_id: taxSettings.tax_rate_id,
        is_reverse_charge_applicable: taxSettings.is_reverse_charge_applicable,
      })
      .returning('*');

      if (taxSettings.tax_components) {
        await trx('tax_components')
          .where('tax_rate_id', taxSettings.tax_rate_id)
          .del();
  
        await trx('tax_components').insert(
          taxSettings.tax_components.map((component): Omit<ITaxComponent, 'tenant'> => ({
            ...component,
            tax_rate_id: taxSettings.tax_rate_id
          }))
        );
      }
  
      if (taxSettings.tax_rate_thresholds) {
        await trx('tax_rate_thresholds')
          .where('tax_rate_id', taxSettings.tax_rate_id)
          .del();
  
        await trx('tax_rate_thresholds').insert(
          taxSettings.tax_rate_thresholds.map((threshold): Omit<ITaxRateThreshold, 'tenant'> => ({
            ...threshold,
            tax_rate_id: taxSettings.tax_rate_id
          }))
        );
      }
  
      if (taxSettings.tax_holidays) {
        await trx('tax_holidays')
          .where('tax_rate_id', taxSettings.tax_rate_id)
          .del();
  
        await trx('tax_holidays').insert(
          taxSettings.tax_holidays.map((holiday): Omit<ITaxHoliday, 'tenant'> => ({
            ...holiday,
          }))
        );
      }
  
      await trx.commit();
  
      return await getCompanyTaxSettings(companyId);
    } catch (error) {
      await trx.rollback();
      console.error('Error updating company tax settings:', error);
      
      // Enhanced error messages with more specific information
      if (error instanceof Error) {
        if (error.message.includes('foreign key constraint')) {
          throw new Error('Invalid tax rate or component reference. Please check your selections.');
        } else if (error.message.includes('duplicate key')) {
          throw new Error('Duplicate entry detected. Please check your tax components or thresholds.');
        } else if (error.message.includes('not found')) {
          throw new Error('One or more tax settings components could not be found.');
        } else {
          throw new Error(`Failed to update company tax settings: ${error.message}`);
        }
      } else {
        throw new Error('Failed to update company tax settings due to an unexpected error.');
      }
    }
}

export async function getTaxRates(): Promise<ITaxRate[]> {
  try {
    const { knex } = await createTenantKnex();
    const taxRates = await knex<ITaxRate>('tax_rates')
      .select('*')
      .where('is_active', true);

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

export async function createDefaultTaxSettings(companyId: string): Promise<ICompanyTaxSettings> {
  const taxService = new TaxService();
  return taxService.createDefaultTaxSettings(companyId);
}
