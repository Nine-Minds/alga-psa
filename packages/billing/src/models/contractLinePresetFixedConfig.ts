// server/src/lib/models/contractLinePresetFixedConfig.ts
import { Knex } from 'knex';
import type { IContractLinePresetFixedConfig } from '@alga-psa/types';
import { requireTenantId } from '@alga-psa/db';

const ContractLinePresetFixedConfig = {
  /**
   * Get fixed config for a preset
   */
  getByPresetId: async (
    knexOrTrx: Knex | Knex.Transaction,
    presetId: string
  ): Promise<IContractLinePresetFixedConfig | null> => {
    const tenant = await requireTenantId(knexOrTrx);

    try {
      const config = await knexOrTrx<IContractLinePresetFixedConfig>('contract_line_preset_fixed_config')
        .where({
          preset_id: presetId,
          tenant
        })
        .first();

      return config || null;
    } catch (error) {
      console.error(`Error fetching fixed config for preset ${presetId}:`, error);
      throw error;
    }
  },

  /**
   * Create or update fixed config for a preset
   */
  upsert: async (
    knexOrTrx: Knex | Knex.Transaction,
    presetId: string,
    configData: Omit<IContractLinePresetFixedConfig, 'preset_id' | 'tenant' | 'created_at' | 'updated_at'>
  ): Promise<IContractLinePresetFixedConfig> => {
    const tenant = await requireTenantId(knexOrTrx);

    const configWithKeys = {
      ...configData,
      preset_id: presetId,
      tenant
    };

    try {
      // Check if config exists
      const existing = await ContractLinePresetFixedConfig.getByPresetId(knexOrTrx, presetId);

      if (existing) {
        // Update existing config
        const [updatedConfig] = await knexOrTrx<IContractLinePresetFixedConfig>('contract_line_preset_fixed_config')
          .where({
            preset_id: presetId,
            tenant
          })
          .update({
            ...configData,
            updated_at: knexOrTrx.fn.now()
          })
          .returning('*');

        return updatedConfig;
      } else {
        // Insert new config
        const [createdConfig] = await knexOrTrx<IContractLinePresetFixedConfig>('contract_line_preset_fixed_config')
          .insert(configWithKeys)
          .returning('*');

        return createdConfig;
      }
    } catch (error) {
      console.error(`Error upserting fixed config for preset ${presetId}:`, error);
      throw error;
    }
  },

  /**
   * Delete fixed config for a preset
   */
  deleteByPresetId: async (
    knexOrTrx: Knex | Knex.Transaction,
    presetId: string
  ): Promise<void> => {
    const tenant = await requireTenantId(knexOrTrx);

    try {
      await knexOrTrx('contract_line_preset_fixed_config')
        .where({
          preset_id: presetId,
          tenant
        })
        .delete();
    } catch (error) {
      console.error(`Error deleting fixed config for preset ${presetId}:`, error);
      throw error;
    }
  }
};

export default ContractLinePresetFixedConfig;
