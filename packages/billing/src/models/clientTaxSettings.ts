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

async function assertTenantTaxComponents(
  conn: Knex | Knex.Transaction,
  tenant: string,
  components: ITaxComponent[]
): Promise<void> {
  const componentIds = Array.from(new Set(components.map((component) => component.tax_component_id)));
  if (componentIds.length === 0) {
    return;
  }

  const foundIds = await tenantScopedTable<Pick<ITaxComponent, 'tax_component_id'>>(
    conn,
    tenant,
    'tax_components'
  )
    .whereIn('tax_component_id', componentIds)
    .pluck('tax_component_id');
  const found = new Set(foundIds.map((id) => String(id)));
  const missing = componentIds.filter((id) => !found.has(String(id)));

  if (missing.length > 0) {
    throw new Error('One or more tax components do not belong to this tenant');
  }
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
      const facade = tenantDb(db, tenant);
      const componentsQuery = facade.parentScopedTable<ITaxComponent>('composite_tax_mappings as ctm')
        .where('ctm.composite_tax_id', tax_rate_id)
        .orderBy('ctm.sequence');
      facade.tenantJoin(componentsQuery, 'tax_components as tc', 'ctm.tax_component_id', 'tc.tax_component_id', {
        tenantPredicate: 'literal',
      });
      const components = await componentsQuery.select('tc.*') as ITaxComponent[];
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
      const thresholds = await tenantDb(db, tenant)
        .parentScopedTable<ITaxRateThreshold>('tax_rate_thresholds')
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
      const holidays = await tenantDb(db, tenant)
        .parentScopedTable<ITaxHoliday>('tax_holidays')
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

      await assertTenantTaxComponents(trx, tenant, components);
      await tenantDb(trx, tenant).insertParentScoped<ICompositeTaxMapping>(
        'composite_tax_mappings',
        compositeMappings
      );

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

      await tenantDb(trx, tenant).parentScopedTable<ICompositeTaxMapping>('composite_tax_mappings')
        .where({ composite_tax_id: tax_rate_id })
        .del();

      const compositeMappings = components.map((component, index): ICompositeTaxMapping => ({
        composite_tax_id: tax_rate_id,
        tax_component_id: component.tax_component_id,
        sequence: index + 1,
      }));

      await assertTenantTaxComponents(trx, tenant, components);
      await tenantDb(trx, tenant).insertParentScoped<ICompositeTaxMapping>(
        'composite_tax_mappings',
        compositeMappings
      );

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
