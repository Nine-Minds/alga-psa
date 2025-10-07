import { Knex } from 'knex';
import { createTenantKnex } from '../db';
import { IClientTaxSettings, ITaxRate, ITaxComponent, ICompositeTaxMapping, ITaxRateThreshold, ITaxHoliday } from '../../interfaces/tax.interfaces';

const ClientTaxSettings = {
  async get(clientId: string): Promise<IClientTaxSettings | null> {
    try {
      const { knex: db, tenant } = await createTenantKnex();
      
      if (!tenant) {
        throw new Error('Tenant context is required for tax settings operations');
      }

      const taxSettings = await db<IClientTaxSettings>('client_tax_settings')
        .where({
          client_id: clientId,
          tenant
        })
        .first();

      // Removed fetching of components, thresholds, holidays (lines 22-24)
      // These details are linked to specific tax_rates, not the general client_tax_settings record.
      // The IClientTaxSettings interface no longer includes these properties.

      return taxSettings || null;
    } catch (error) {
      console.error(`Error getting tax settings for client ${clientId}:`, error);
      throw error;
    }
  },

  async create(taxSettings: Omit<IClientTaxSettings, 'tenant'>): Promise<IClientTaxSettings> {
    try {
      const { knex: db, tenant } = await createTenantKnex();
      const [createdSettings] = await db<IClientTaxSettings>('client_tax_settings')
        .insert({ ...taxSettings, tenant: tenant! })
        .returning('*');

      return createdSettings;
    } catch (error) {
      console.error('Error creating client tax settings:', error);
      throw error;
    }
  },

  async update(clientId: string, taxSettings: Partial<IClientTaxSettings>): Promise<IClientTaxSettings> {
    try {
      const { knex: db, tenant } = await createTenantKnex();
      
      if (!tenant) {
        throw new Error('Tenant context is required for tax settings operations');
      }

      const [updatedSettings] = await db<IClientTaxSettings>('client_tax_settings')
        .where({
          client_id: clientId,
          tenant
        })
        .update(taxSettings)
        .returning('*');

      return updatedSettings;
    } catch (error) {
      console.error(`Error updating tax settings for client ${clientId}:`, error);
      throw error;
    }
  },

  async getTaxRate(tax_rate_id: string): Promise<ITaxRate | undefined> {
    try {
      const { knex: db, tenant } = await createTenantKnex();
      if (!tenant) {
        throw new Error('Tenant context is required for tax rate lookup');
      }
      const taxRate = await db<ITaxRate>('tax_rates')
        .where({
          tax_rate_id,
          tenant
        })
        .first();
      return taxRate;
    } catch (error) {
      console.error(`Error getting tax rate ${tax_rate_id}:`, error);
      throw error;
    }
  },

  async getCompositeTaxComponents(tax_rate_id: string): Promise<ITaxComponent[]> {
    try {
      const { knex: db, tenant } = await createTenantKnex();
      if (!tenant) {
        throw new Error('Tenant context is required for tax components lookup');
      }
      // const components = await db<ITaxComponent>('tax_components')
      //   .join('composite_tax_mappings', 'tax_components.tax_component_id', 'composite_tax_mappings.tax_component_id')
      //   .where({
      //     'composite_tax_mappings.composite_tax_id': tax_rate_id,
      //     'tax_components.tenant': tenant,
      //     // 'composite_tax_mappings.tenant': tenant
      //   })
      //   .orderBy('composite_tax_mappings.sequence')
      //   .select('tax_components.*');
      // return components;
      return [];
    } catch (error) {
      console.error(`Error getting composite tax components for tax rate ${tax_rate_id}:`, error);
      throw error;
    }
  },

  async getTaxRateThresholds(tax_rate_id: string): Promise<ITaxRateThreshold[]> {
    try {
      const { knex: db, tenant } = await createTenantKnex();
      if (!tenant) {
        throw new Error('Tenant context is required for tax rate thresholds lookup');
      }
      // const thresholds = await db<ITaxRateThreshold>('tax_rate_thresholds')
      //   .where({
      //     tax_rate_id,
      //     tenant
      //   })
      //   .orderBy('min_amount');
      // return thresholds;
      return [];
    } catch (error) {
      console.error(`Error getting tax rate thresholds for tax rate ${tax_rate_id}:`, error);
      throw error;
    }
  },

  async getTaxHolidays(tax_rate_id: string): Promise<ITaxHoliday[]> {
    try {
      const { knex: db, tenant } = await createTenantKnex();
      if (!tenant) {
        throw new Error('Tenant context is required for tax holidays lookup');
      }
      const holidays = await db<ITaxHoliday>('tax_holidays')
        .where('tax_rate_id', tax_rate_id)
        .where('tenant', tenant)
        .orderBy('start_date');
      return holidays;
    } catch (error) {
      console.error(`Error getting tax holidays for tax rate ${tax_rate_id}:`, error);
      throw error;
    }
  },

  async createCompositeTax(taxRate: Omit<ITaxRate, 'tenant'>, components: ITaxComponent[]): Promise<ITaxRate> {
    const { knex: db, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for composite tax operations');
    }

    const trx = await db.transaction();
    try {
      const [createdTaxRate] = await trx<ITaxRate>('tax_rates')
        .insert({ ...taxRate, is_composite: true, tenant: tenant! })
        .returning('*');

      const compositeMappings = components.map((component, index): ICompositeTaxMapping => ({
        composite_tax_id: createdTaxRate.tax_rate_id,
        tax_component_id: component.tax_component_id,
        sequence: index + 1,
        tenant: tenant!
      }));

      await trx<ICompositeTaxMapping>('composite_tax_mappings').insert(compositeMappings);

      await trx.commit();
      return createdTaxRate;
    } catch (error) {
      await trx.rollback();
      console.error('Error creating composite tax:', error);
      throw error;
    }
  },

  async updateCompositeTax(tax_rate_id: string, taxRate: Partial<ITaxRate>, components: ITaxComponent[]): Promise<ITaxRate> {
    const { knex: db, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for composite tax operations');
    }

    const trx = await db.transaction();
    try {
      const [updatedTaxRate] = await trx<ITaxRate>('tax_rates')
        .where({
          tax_rate_id,
          tenant
        })
        .update(taxRate)
        .returning('*');

      await trx<ICompositeTaxMapping>('composite_tax_mappings')
        .where({
          composite_tax_id: tax_rate_id,
          tenant
        })
        .del();

      const compositeMappings = components.map((component, index): ICompositeTaxMapping => ({
        composite_tax_id: tax_rate_id,
        tax_component_id: component.tax_component_id,
        sequence: index + 1,
        tenant: tenant!
      }));

      await trx<ICompositeTaxMapping>('composite_tax_mappings').insert(compositeMappings);

      await trx.commit();
      return updatedTaxRate;
    } catch (error) {
      await trx.rollback();
      console.error(`Error updating composite tax ${tax_rate_id}:`, error);
      throw error;
    }
  },
};

export default ClientTaxSettings;
