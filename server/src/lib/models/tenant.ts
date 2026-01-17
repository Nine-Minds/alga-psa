import logger from '@alga-psa/core/logger';
import { ITenant } from '../../interfaces';
import { getCurrentTenantId } from '../db';
import { Knex } from 'knex';

export const Tenant = {
  getAll: async (knexOrTrx: Knex | Knex.Transaction): Promise<ITenant[]> => {
    try {
      const tenants = await knexOrTrx<ITenant>('tenants').select('*');
      return tenants;
    } catch (error) {
      logger.error('Error getting all tenants:', error);
      throw error;
    }
  },

  findTenantByEmail: async (knexOrTrx: Knex | Knex.Transaction, email: string): Promise<ITenant | undefined> => {
    try {
      const tenant = await knexOrTrx<ITenant>('tenants').select('*').where({ email }).first();
      return tenant;
    } catch (error) {
      logger.error(`Error finding tenant with email ${email}:`, error);
      throw error;
    }
  },

  findTenantByName: async (knexOrTrx: Knex | Knex.Transaction, tenant: string): Promise<ITenant | undefined> => {
    try {
      const tenantRecord = await knexOrTrx<ITenant>('tenants').select('*').where({ tenant }).first();
      return tenantRecord;
    } catch (error) {
      logger.error(`Error finding tenant with name ${tenant}:`, error);
      throw error;
    }
  },

  get: async (knexOrTrx: Knex | Knex.Transaction, tenant: string): Promise<ITenant | undefined> => {
    try {
      const tenantRecord = await knexOrTrx<ITenant>('tenants').select('*').where({ tenant }).first();
      return tenantRecord;
    } catch (error) {
      logger.error(`Error getting tenant with id ${tenant}:`, error);
      throw error;
    }
  },

  insert: async (knexOrTrx: Knex | Knex.Transaction, tenant: ITenant): Promise<ITenant> => {
    try {
      logger.info('Inserting tenant:', tenant);
  
      const [insertedTenant] = await knexOrTrx<ITenant>('tenants').insert(tenant).returning('*');
      return insertedTenant;
    } catch (error) {
      logger.error('Error inserting tenant:', error);
      throw error;
    }
  },

  update: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, tenantData: Partial<ITenant>): Promise<void> => {
    try {
      await knexOrTrx<ITenant>('tenants').where({ tenant }).update(tenantData);
    } catch (error) {
      logger.error(`Error updating tenant with id ${tenant}:`, error);
      throw error;
    }
  },

  updatePaymentInfo: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, payment_platform_id: string, payment_method_id: string): Promise<void> => {
    try {
      await knexOrTrx<ITenant>('tenants').where({ tenant }).update({ payment_platform_id, payment_method_id });
    } catch (error) {
      logger.error(`Error updating payment info for tenant ${tenant}:`, error);
      throw error;
    }
  },

  updatePlan: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, plan: string): Promise<void> => {
    try {
      await knexOrTrx<ITenant>('tenants').where({ tenant }).update({ plan });
    } catch (error) {
      logger.error(`Error updating plan for tenant ${tenant}:`, error);
      throw error;
    }
  },

  delete: async (knexOrTrx: Knex | Knex.Transaction, tenant: string): Promise<void> => {
    try {
      await knexOrTrx<ITenant>('tenants').where({ tenant }).del();
    } catch (error) {
      logger.error(`Error deleting tenant ${tenant}:`, error);
      throw error;
    }
  },
};

interface DefaultStatus {
  name: string;
  is_closed: boolean;
}

export async function getTenantDefaultStatuses(knexOrTrx: Knex | Knex.Transaction, tenantId: string): Promise<DefaultStatus[]> {
  try {
    const result = await knexOrTrx('tenant_settings')
      .where({ tenant: tenantId })
      .select('default_project_statuses')
      .first();

    if (result && result.default_project_statuses) {
      return JSON.parse(result.default_project_statuses);
    }

    // Return a default set of statuses if none are configured for the tenant
    return [
      { name: 'Not Started', is_closed: false },
      { name: 'In Progress', is_closed: false },
      { name: 'On Hold', is_closed: false },
      { name: 'Completed', is_closed: true },
      { name: 'Cancelled', is_closed: true }
    ];
  } catch (error) {
    console.error('Error fetching tenant default statuses:', error);
    throw new Error('Failed to fetch tenant default statuses');
  }
}

export default Tenant;
