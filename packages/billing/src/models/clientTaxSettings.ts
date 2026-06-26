import { Knex } from 'knex';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import type {
  IClientTaxSettings,
  ITaxComponent,
  ICompositeTaxMapping,
  ITaxHoliday,
  ITaxRateDetails as ITaxRate,
  ITaxRateThreshold,
} from '@alga-psa/types';

function tenantScopedTable<Row extends object = Record<string, any>>(
  conn: Knex | Knex.Transaction,
  tenant: string,
  table: string
): Knex.QueryBuilder<Row, Row[]> {
  return tenantDb(conn, tenant).table<Row>(table);
}

const ClientTaxSettings = {
  async get(clientId: string): Promise<IClientTaxSettings | null> {
    try {
      const { knex: db, tenant } = await createTenantKnex();
      
      if (!tenant) {
        throw new Error('Tenant context is required for tax settings operations');
      }

      const taxSettings = await tenantScopedTable<IClientTaxSettings>(db, tenant, 'client_tax_settings')
        .where({
          client_id: clientId
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
      const [createdSettings] = await tenantScopedTable<IClientTaxSettings>(db, tenant!, 'client_tax_settings')
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

      const [updatedSettings] = await tenantScopedTable<IClientTaxSettings>(db, tenant, 'client_tax_settings')
        .where({
          client_id: clientId
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
      const taxRate = await tenantScopedTable<ITaxRate>(db, tenant, 'tax_rates')
        .where({
          tax_rate_id
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
      // composite_tax_mappings has no tenant column; tax_components.tenant gates isolation.
      const components = await tenantScopedTable<ITaxComponent>(db, tenant, 'tax_components')
        .join('composite_tax_mappings', 'tax_components.tax_component_id', 'composite_tax_mappings.tax_component_id')
        .where({
          'composite_tax_mappings.composite_tax_id': tax_rate_id,
        })
        .orderBy('composite_tax_mappings.sequence')
        .select('tax_components.*');
      return components;
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
      const thresholds = await tenantDb(db, tenant).unscoped<ITaxRateThreshold>(
        'tax_rate_thresholds',
        'tax_rate_thresholds are scoped by parent tax_rates.tax_rate_id'
      )
        .where({ tax_rate_id })
        .orderBy('min_amount');
      return thresholds;
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
      const holidays = await tenantDb(db, tenant).unscoped<ITaxHoliday>(
        'tax_holidays',
        'tax_holidays are scoped by parent tax_rates.tax_rate_id'
      )
        .where('tax_rate_id', tax_rate_id)
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
      const [createdTaxRate] = await tenantScopedTable<ITaxRate>(trx, tenant, 'tax_rates')
        .insert({ ...taxRate, is_composite: true, tenant: tenant! })
        .returning('*');

      const compositeMappings = components.map((component, index): ICompositeTaxMapping => ({
        composite_tax_id: createdTaxRate.tax_rate_id,
        tax_component_id: component.tax_component_id,
        sequence: index + 1,
      }));

      await tenantDb(trx, tenant).unscoped<ICompositeTaxMapping>(
        'composite_tax_mappings',
        'composite_tax_mappings are scoped by parent composite tax rates and tax components'
      ).insert(compositeMappings);

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
      const [updatedTaxRate] = await tenantScopedTable<ITaxRate>(trx, tenant, 'tax_rates')
        .where({
          tax_rate_id
        })
        .update(taxRate)
        .returning('*');

      await tenantDb(trx, tenant).unscoped<ICompositeTaxMapping>(
        'composite_tax_mappings',
        'composite_tax_mappings are scoped by parent composite tax rates and tax components'
      )
        .where({ composite_tax_id: tax_rate_id })
        .del();

      const compositeMappings = components.map((component, index): ICompositeTaxMapping => ({
        composite_tax_id: tax_rate_id,
        tax_component_id: component.tax_component_id,
        sequence: index + 1,
      }));

      await tenantDb(trx, tenant).unscoped<ICompositeTaxMapping>(
        'composite_tax_mappings',
        'composite_tax_mappings are scoped by parent composite tax rates and tax components'
      ).insert(compositeMappings);

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
