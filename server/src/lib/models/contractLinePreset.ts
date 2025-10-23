// server/src/lib/models/contractLinePreset.ts
import { Knex } from 'knex';
import { IContractLinePreset } from 'server/src/interfaces';
import { getCurrentTenantId } from 'server/src/lib/db';
import { v4 as uuidv4 } from 'uuid';

const ContractLinePreset = {
  getAll: async (knexOrTrx: Knex | Knex.Transaction): Promise<IContractLinePreset[]> => {
    const tenant = await getCurrentTenantId();

    if (!tenant) {
      throw new Error('Tenant context is required for fetching contract line presets');
    }

    try {
      const presets = await knexOrTrx<IContractLinePreset>('contract_line_presets')
        .where({ tenant })
        .select('*')
        .orderBy('created_at', 'desc');

      console.log(`Retrieved ${presets.length} contract line presets for tenant ${tenant}`);
      return presets;
    } catch (error) {
      console.error('Error fetching contract line presets:', error);
      throw error;
    }
  },

  findById: async (knexOrTrx: Knex | Knex.Transaction, presetId: string): Promise<IContractLinePreset | null> => {
    const tenant = await getCurrentTenantId();
    if (!tenant) {
      throw new Error('Tenant context is required for fetching a contract line preset');
    }

    try {
      const preset = await knexOrTrx<IContractLinePreset>('contract_line_presets')
        .where({
          preset_id: presetId,
          tenant: tenant
        })
        .first();

      if (!preset) {
        console.warn(`Contract line preset ${presetId} not found for tenant ${tenant}`);
        return null;
      }

      console.log(`Retrieved contract line preset ${presetId} for tenant ${tenant}`);
      return preset;
    } catch (error) {
      console.error(`Error fetching contract line preset ${presetId}:`, error);
      throw error;
    }
  },

  create: async (knexOrTrx: Knex | Knex.Transaction, preset: Omit<IContractLinePreset, 'preset_id' | 'tenant' | 'created_at' | 'updated_at'>): Promise<IContractLinePreset> => {
    const tenant = await getCurrentTenantId();
    if (!tenant) {
      throw new Error('No tenant found');
    }

    const presetWithId = {
      ...preset,
      preset_id: uuidv4(),
      tenant
    };

    const [createdPreset] = await knexOrTrx<IContractLinePreset>('contract_line_presets')
      .insert(presetWithId)
      .returning('*');

    return createdPreset;
  },

  update: async (knexOrTrx: Knex | Knex.Transaction, presetId: string, updateData: Partial<IContractLinePreset>): Promise<IContractLinePreset> => {
    const tenant = await getCurrentTenantId();

    if (!tenant) {
      throw new Error('Tenant context is required for updating contract line preset');
    }

    try {
      // Remove tenant from update data to prevent modification
      const { tenant: _, preset_id: __, ...dataToUpdate } = updateData;

      const [updatedPreset] = await knexOrTrx<IContractLinePreset>('contract_line_presets')
        .where({
          preset_id: presetId,
          tenant
        })
        .update({
          ...dataToUpdate,
          updated_at: knexOrTrx.fn.now()
        })
        .returning('*');

      if (!updatedPreset) {
        throw new Error(`Contract line preset ${presetId} not found or belongs to different tenant`);
      }

      return updatedPreset;
    } catch (error) {
      console.error(`Error updating contract line preset ${presetId}:`, error);
      throw error;
    }
  },

  delete: async (knexOrTrx: Knex | Knex.Transaction, presetId: string): Promise<void> => {
    const tenant = await getCurrentTenantId();

    if (!tenant) {
      throw new Error('Tenant context is required for deleting contract line preset');
    }

    try {
      const deletedCount = await knexOrTrx('contract_line_presets')
        .where({
          preset_id: presetId,
          tenant
        })
        .delete();

      if (deletedCount === 0) {
        throw new Error(`Contract line preset ${presetId} not found or belongs to different tenant`);
      }
    } catch (error) {
      console.error(`Error deleting contract line preset ${presetId}:`, error);
      throw error;
    }
  },
};

export default ContractLinePreset;
