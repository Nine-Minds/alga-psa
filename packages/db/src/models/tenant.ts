import logger from '@alga-psa/core/logger';
import type { ITenant } from '@alga-psa/types';
import type { Knex } from 'knex';
import { tenantDb } from '../lib/tenantDb';

const TENANT_MODEL_DISCOVERY_TENANT = '__tenant_model_discovery__';

export const Tenant = {
  getAll: async (knexOrTrx: Knex | Knex.Transaction): Promise<ITenant[]> => {
    try {
      const tenants = await tenantDb(knexOrTrx, TENANT_MODEL_DISCOVERY_TENANT)
        .unscoped<ITenant>('tenants', 'tenant model enumerates tenants without a tenant context')
        .select('*');
      return tenants;
    } catch (error) {
      logger.error('Error getting all tenants:', error);
      throw error;
    }
  },

  findTenantByEmail: async (knexOrTrx: Knex | Knex.Transaction, email: string): Promise<ITenant | undefined> => {
    try {
      const tenant = await tenantDb(knexOrTrx, TENANT_MODEL_DISCOVERY_TENANT)
        .unscoped<ITenant>('tenants', 'tenant discovery by email before tenant context exists')
        .select('*')
        .where({ email })
        .first();
      return tenant;
    } catch (error) {
      logger.error(`Error finding tenant with email ${email}:`, error);
      throw error;
    }
  },

  findTenantByName: async (knexOrTrx: Knex | Knex.Transaction, tenant: string): Promise<ITenant | undefined> => {
    try {
      const tenantRecord = await tenantDb(knexOrTrx, tenant)
        .table<ITenant>('tenants')
        .select('*')
        .first();
      return tenantRecord;
    } catch (error) {
      logger.error(`Error finding tenant with name ${tenant}:`, error);
      throw error;
    }
  },

  get: async (knexOrTrx: Knex | Knex.Transaction, tenant: string): Promise<ITenant | undefined> => {
    try {
      const tenantRecord = await tenantDb(knexOrTrx, tenant)
        .table<ITenant>('tenants')
        .select('*')
        .first();
      return tenantRecord;
    } catch (error) {
      logger.error(`Error getting tenant with id ${tenant}:`, error);
      throw error;
    }
  },

  insert: async (knexOrTrx: Knex | Knex.Transaction, tenant: ITenant): Promise<ITenant> => {
    try {
      logger.info('Inserting tenant:', tenant);

      if (!tenant.tenant) {
        throw new Error('Tenant id is required to insert tenant');
      }

      const [insertedTenant] = await tenantDb(knexOrTrx, tenant.tenant)
        .table<ITenant>('tenants')
        .insert(tenant)
        .returning('*');
      return insertedTenant;
    } catch (error) {
      logger.error('Error inserting tenant:', error);
      throw error;
    }
  },

  update: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, tenantData: Partial<ITenant>): Promise<void> => {
    try {
      await tenantDb(knexOrTrx, tenant)
        .table<ITenant>('tenants')
        .update(tenantData);
    } catch (error) {
      logger.error(`Error updating tenant with id ${tenant}:`, error);
      throw error;
    }
  },

  updatePaymentInfo: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    payment_platform_id: string,
    payment_method_id: string
  ): Promise<void> => {
    try {
      await tenantDb(knexOrTrx, tenant)
        .table<ITenant>('tenants')
        .update({ payment_platform_id, payment_method_id });
    } catch (error) {
      logger.error(`Error updating payment info for tenant ${tenant}:`, error);
      throw error;
    }
  },

  updatePlan: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, plan: ITenant['plan']): Promise<void> => {
    try {
      await tenantDb(knexOrTrx, tenant)
        .table<ITenant>('tenants')
        .update({ plan });
    } catch (error) {
      logger.error(`Error updating plan for tenant ${tenant}:`, error);
      throw error;
    }
  },

  delete: async (knexOrTrx: Knex | Knex.Transaction, tenant: string): Promise<void> => {
    try {
      await tenantDb(knexOrTrx, tenant)
        .table<ITenant>('tenants')
        .del();
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

export async function getTenantDefaultStatuses(
  knexOrTrx: Knex | Knex.Transaction,
  tenantId: string
): Promise<DefaultStatus[]> {
  try {
    const result = await tenantDb(knexOrTrx, tenantId)
      .table('tenant_settings')
      .select('default_project_statuses')
      .first();

    if (result && (result as any).default_project_statuses) {
      return JSON.parse((result as any).default_project_statuses);
    }

    return [
      { name: 'Not Started', is_closed: false },
      { name: 'In Progress', is_closed: false },
      { name: 'On Hold', is_closed: false },
      { name: 'Completed', is_closed: true },
      { name: 'Cancelled', is_closed: true },
    ];
  } catch (error) {
    console.error('Error fetching tenant default statuses:', error);
    throw new Error('Failed to fetch tenant default statuses');
  }
}

export default Tenant;
