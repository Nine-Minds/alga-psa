// server/src/lib/models/contractLinePreset.ts
import { Knex } from 'knex';
import type { IContractLinePreset } from '@alga-psa/types';
import { requireTenantId } from '@alga-psa/db';
import { v4 as uuidv4 } from 'uuid';

const ContractLinePreset = {
  getAll: async (knexOrTrx: Knex | Knex.Transaction): Promise<IContractLinePreset[]> => {
    const tenant = await requireTenantId(knexOrTrx);

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
    const tenant = await requireTenantId(knexOrTrx);

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
    const tenant = await requireTenantId(knexOrTrx);

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
    const tenant = await requireTenantId(knexOrTrx);

    try {
      // Remove tenant from update data to prevent modification
      const { tenant: _, preset_id: __, ...dataToUpdate } = updateData;

      const [updatedPreset] = await knexOrTrx<IContractLinePreset>('contract_line_presets')
        .where({
          preset_id: presetId,
          tenant
        })
        .update(dataToUpdate)
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
    const tenant = await requireTenantId(knexOrTrx);

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
