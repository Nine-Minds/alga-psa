// server/src/lib/models/contractLinePresetService.ts
import { Knex } from 'knex';
import { IContractLinePresetService } from 'server/src/interfaces/billing.interfaces';
import { getCurrentTenantId } from 'server/src/lib/db';

const ContractLinePresetService = {
  /**
   * Get all services for a preset
   */
  getByPresetId: async (
    knexOrTrx: Knex | Knex.Transaction,
    presetId: string
  ): Promise<IContractLinePresetService[]> => {
    const tenant = await getCurrentTenantId();
    if (!tenant) {
      throw new Error('Tenant context is required for fetching preset services');
    }

    try {
      const services = await knexOrTrx<IContractLinePresetService>('contract_line_preset_services')
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
   * Create a service association for a preset
   */
  create: async (
    knexOrTrx: Knex | Knex.Transaction,
    serviceData: Omit<IContractLinePresetService, 'tenant' | 'created_at' | 'updated_at'>
  ): Promise<IContractLinePresetService> => {
    const tenant = await getCurrentTenantId();
    if (!tenant) {
      throw new Error('No tenant found');
    }

    const serviceWithTenant = {
      ...serviceData,
      tenant
    };

    const [createdService] = await knexOrTrx<IContractLinePresetService>('contract_line_preset_services')
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
    const tenant = await getCurrentTenantId();
    if (!tenant) {
      throw new Error('Tenant context is required for deleting preset services');
    }

    try {
      await knexOrTrx('contract_line_preset_services')
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
    const tenant = await getCurrentTenantId();
    if (!tenant) {
      throw new Error('No tenant found');
    }

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

      const createdServices = await knexOrTrx<IContractLinePresetService>('contract_line_preset_services')
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
