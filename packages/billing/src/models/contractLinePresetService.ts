// server/src/lib/models/contractLinePresetService.ts
import { Knex } from 'knex';
import type { IContractLinePresetService } from '@alga-psa/types';
import { requireTenantId, tenantDb } from '@alga-psa/db';

const ContractLinePresetService = {
  /**
   * Get all services for a preset
   */
  getByPresetId: async (
    knexOrTrx: Knex | Knex.Transaction,
    presetId: string
  ): Promise<IContractLinePresetService[]> => {
    const tenant = await requireTenantId(knexOrTrx);

    try {
      const services = await tenantDb(knexOrTrx, tenant).table<IContractLinePresetService>('contract_line_preset_services')
        .where({
          preset_id: presetId,
          tenant
        })
        .select('*');

      return services;
    } catch (error) {
      console.error(`Error fetching services for preset ${presetId}:`, error);
      throw error;
    }
  },

  /**
   * Get the service count for every preset in one query (keyed by preset_id).
   */
  getServiceCountsByPreset: async (
    knexOrTrx: Knex | Knex.Transaction
  ): Promise<Record<string, number>> => {
    const tenant = await requireTenantId(knexOrTrx);

    const rows = await tenantDb(knexOrTrx, tenant).table('contract_line_preset_services')
      .where({ tenant })
      .groupBy('preset_id')
      .select('preset_id')
      .count<{ preset_id: string; count: string | number }[]>('* as count');

    return rows.reduce<Record<string, number>>((counts, row) => {
      counts[row.preset_id] = Number(row.count) || 0;
      return counts;
    }, {});
  },

  /**
   * Create a service association for a preset
   */
  create: async (
    knexOrTrx: Knex | Knex.Transaction,
    serviceData: Omit<IContractLinePresetService, 'tenant' | 'created_at' | 'updated_at'>
  ): Promise<IContractLinePresetService> => {
    const tenant = await requireTenantId(knexOrTrx);

    const serviceWithTenant = {
      ...serviceData,
      tenant
    };

    const [createdService] = await tenantDb(knexOrTrx, tenant).table<IContractLinePresetService>('contract_line_preset_services')
      .insert(serviceWithTenant)
      .returning('*');

    return createdService;
  },

  /**
   * Delete all services for a preset
   */
  deleteByPresetId: async (
    knexOrTrx: Knex | Knex.Transaction,
    presetId: string
  ): Promise<void> => {
    const tenant = await requireTenantId(knexOrTrx);

    try {
      await tenantDb(knexOrTrx, tenant).table('contract_line_preset_services')
        .where({
          preset_id: presetId,
          tenant
        })
        .delete();
    } catch (error) {
      console.error(`Error deleting services for preset ${presetId}:`, error);
      throw error;
    }
  },

  /**
   * Update services for a preset (delete all and recreate)
   */
  updateForPreset: async (
    knexOrTrx: Knex | Knex.Transaction,
    presetId: string,
    services: Omit<IContractLinePresetService, 'tenant' | 'created_at' | 'updated_at'>[]
  ): Promise<IContractLinePresetService[]> => {
    const tenant = await requireTenantId(knexOrTrx);

    try {
      // Delete existing services
      await ContractLinePresetService.deleteByPresetId(knexOrTrx, presetId);

      // Insert new services
      if (services.length === 0) {
        return [];
      }

      const servicesWithTenant = services.map(service => ({
        ...service,
        tenant
      }));

      const createdServices = await tenantDb(knexOrTrx, tenant).table<IContractLinePresetService>('contract_line_preset_services')
        .insert(servicesWithTenant)
        .returning('*');

      return createdServices;
    } catch (error) {
      console.error(`Error updating services for preset ${presetId}:`, error);
      throw error;
    }
  }
};

export default ContractLinePresetService;
