// server/src/lib/models/contractLinePreset.ts
import { Knex } from 'knex';
import type { IContractLinePreset } from '@alga-psa/types';
import { v4 as uuidv4 } from 'uuid';
import { resolveRecurringAuthoringPolicy } from '@shared/billingClients/recurringAuthoringPolicy';

function normalizeContractLinePreset<T extends Partial<IContractLinePreset>>(
  preset: T,
): T & Pick<IContractLinePreset, 'cadence_owner' | 'billing_timing'> {
  const recurringAuthoringPolicy = resolveRecurringAuthoringPolicy({
    cadenceOwner: preset.cadence_owner,
    billingTiming: preset.billing_timing,
  });

  return {
    ...preset,
    cadence_owner: recurringAuthoringPolicy.cadenceOwner,
    billing_timing: recurringAuthoringPolicy.billingTiming,
  };
}

const ContractLinePreset = {
  getAll: async (knexOrTrx: Knex | Knex.Transaction, tenant: string): Promise<IContractLinePreset[]> => {
    try {
      const presets = await knexOrTrx<IContractLinePreset>('contract_line_presets')
        .where({ tenant })
        .select('*')
        .orderBy('created_at', 'desc');

      console.log(`Retrieved ${presets.length} contract line presets for tenant ${tenant}`);
      return presets.map((preset) => normalizeContractLinePreset(preset));
    } catch (error) {
      console.error('Error fetching contract line presets:', error);
      throw error;
    }
  },

  findById: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, presetId: string): Promise<IContractLinePreset | null> => {
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
      return normalizeContractLinePreset(preset);
    } catch (error) {
      console.error(`Error fetching contract line preset ${presetId}:`, error);
      throw error;
    }
  },

  create: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    preset: Omit<IContractLinePreset, 'preset_id' | 'tenant' | 'created_at' | 'updated_at'>
  ): Promise<IContractLinePreset> => {
    const recurringAuthoringPolicy = resolveRecurringAuthoringPolicy({
      cadenceOwner: preset.cadence_owner,
      billingTiming: preset.billing_timing,
    });
    const presetWithId = {
      ...preset,
      cadence_owner: recurringAuthoringPolicy.cadenceOwner,
      billing_timing: recurringAuthoringPolicy.billingTiming,
      preset_id: uuidv4(),
      tenant
    };

    const [createdPreset] = await knexOrTrx<IContractLinePreset>('contract_line_presets')
      .insert(presetWithId)
      .returning('*');

    return normalizeContractLinePreset(createdPreset);
  },

  update: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    presetId: string,
    updateData: Partial<IContractLinePreset>
  ): Promise<IContractLinePreset> => {
    try {
      const existingPreset = await knexOrTrx<IContractLinePreset>('contract_line_presets')
        .where({
          preset_id: presetId,
          tenant
        })
        .first();

      if (!existingPreset) {
        throw new Error(`Contract line preset ${presetId} not found or belongs to different tenant`);
      }

      // Remove tenant from update data to prevent modification
      const { tenant: _, preset_id: __, ...dataToUpdate } = updateData;
      const recurringAuthoringPolicy = resolveRecurringAuthoringPolicy({
        cadenceOwner: dataToUpdate.cadence_owner,
        fallbackCadenceOwner: existingPreset.cadence_owner,
        billingTiming: dataToUpdate.billing_timing,
        fallbackBillingTiming: existingPreset.billing_timing,
      });
      const updatePayload = {
        ...dataToUpdate,
        cadence_owner: recurringAuthoringPolicy.cadenceOwner,
        billing_timing: recurringAuthoringPolicy.billingTiming,
      };

      const [updatedPreset] = await knexOrTrx<IContractLinePreset>('contract_line_presets')
        .where({
          preset_id: presetId,
          tenant
        })
        .update(updatePayload)
        .returning('*');

      if (!updatedPreset) {
        throw new Error(`Contract line preset ${presetId} not found or belongs to different tenant`);
      }

      return normalizeContractLinePreset(updatedPreset);
    } catch (error) {
      console.error(`Error updating contract line preset ${presetId}:`, error);
      throw error;
    }
  },

  delete: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, presetId: string): Promise<void> => {
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
