// server/src/lib/actions/contractLinePresetActions.ts
'use server'
import ContractLinePreset from 'server/src/lib/models/contractLinePreset';
import ContractLinePresetService from 'server/src/lib/models/contractLinePresetService';
import ContractLinePresetFixedConfig from 'server/src/lib/models/contractLinePresetFixedConfig';
import { IContractLinePreset, IContractLinePresetService, IContractLinePresetFixedConfig } from 'server/src/interfaces/billing.interfaces';
import { createTenantKnex } from 'server/src/lib/db';
import { Knex } from 'knex';
import { withTransaction } from '@alga-psa/shared/db';
import { getCurrentUser } from './user-actions/userActions';
import { hasPermission } from 'server/src/lib/auth/rbac';
import { analytics } from '../analytics/posthog';
import { AnalyticsEvents } from '../analytics/events';

export async function getContractLinePresets(): Promise<IContractLinePreset[]> {
    try {
        const isBypass = process.env.E2E_AUTH_BYPASS === 'true';
        const currentUser = isBypass ? ({} as any) : await getCurrentUser();
        if (!currentUser && !isBypass) {
            throw new Error('No authenticated user found');
        }

        const { knex, tenant } = await createTenantKnex();
        if (!tenant) {
            throw new Error("tenant context not found");
        }

        return await withTransaction(knex, async (trx: Knex.Transaction) => {
            if (!isBypass && !await hasPermission(currentUser, 'billing', 'read', trx)) {
                throw new Error('Permission denied: Cannot read contract line presets');
            }

            const presets = await ContractLinePreset.getAll(trx);
            return presets;
        });
    } catch (error) {
        console.error('Error fetching contract line presets:', error);
        if (error instanceof Error) {
            throw error;
        }
        throw new Error(`Failed to fetch contract line presets: ${error}`);
    }
}

export async function getContractLinePresetById(presetId: string): Promise<IContractLinePreset | null> {
    try {
        const isBypass = process.env.E2E_AUTH_BYPASS === 'true';
        const currentUser = isBypass ? ({} as any) : await getCurrentUser();
        if (!currentUser && !isBypass) {
            throw new Error('No authenticated user found');
        }

        const { knex, tenant } = await createTenantKnex();
        if (!tenant) {
            throw new Error("tenant context not found");
        }

        return await withTransaction(knex, async (trx: Knex.Transaction) => {
            if (!isBypass && !await hasPermission(currentUser, 'billing', 'read', trx)) {
                throw new Error('Permission denied: Cannot read contract line presets');
            }

            const preset = await ContractLinePreset.findById(trx, presetId);
            return preset;
        });
    } catch (error) {
        console.error(`Error fetching contract line preset with ID ${presetId}:`, error);
        if (error instanceof Error) {
            if (error.message.includes('not found')) {
                return null;
            }
            throw error;
        }
        throw new Error(`Failed to fetch contract line preset ${presetId}: ${error}`);
    }
}

export async function createContractLinePreset(
    presetData: Omit<IContractLinePreset, 'preset_id' | 'tenant' | 'created_at' | 'updated_at'>
): Promise<IContractLinePreset> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error('No authenticated user found');
        }

        const { knex, tenant } = await createTenantKnex();
        if (!tenant) {
            throw new Error("tenant context not found");
        }

        return await withTransaction(knex, async (trx: Knex.Transaction) => {
            if (!await hasPermission(currentUser, 'billing', 'create', trx)) {
                throw new Error('Permission denied: Cannot create contract line presets');
            }

            const { tenant: _, ...safePresetData } = presetData as any;
            const preset = await ContractLinePreset.create(trx, safePresetData);

            // Track analytics
            analytics.capture(AnalyticsEvents.BILLING_RULE_CREATED, {
                preset_id: preset.preset_id,
                preset_name: preset.preset_name,
                contract_line_type: preset.contract_line_type,
                is_preset: true
            }, currentUser.user_id);

            return preset;
        });
    } catch (error) {
        console.error('Error creating contract line preset:', error);
        if (error instanceof Error) {
            throw error;
        }
        throw new Error(`Failed to create contract line preset: ${error}`);
    }
}

export async function updateContractLinePreset(
    presetId: string,
    updateData: Partial<IContractLinePreset>
): Promise<IContractLinePreset> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error('No authenticated user found');
        }

        const { knex, tenant } = await createTenantKnex();
        if (!tenant) {
            throw new Error("tenant context not found");
        }

        return await withTransaction(knex, async (trx: Knex.Transaction) => {
            if (!await hasPermission(currentUser, 'billing', 'update', trx)) {
                throw new Error('Permission denied: Cannot update contract line presets');
            }

            const existingPreset = await ContractLinePreset.findById(trx, presetId);
            if (!existingPreset) {
                throw new Error(`Contract Line Preset with ID ${presetId} not found.`);
            }

            const { tenant: _, preset_id: __, ...safeUpdateData } = updateData as any;
            const preset = await ContractLinePreset.update(trx, presetId, safeUpdateData);

            // Track analytics
            analytics.capture(AnalyticsEvents.BILLING_RULE_UPDATED, {
                preset_id: preset.preset_id,
                preset_name: preset.preset_name,
                contract_line_type: preset.contract_line_type,
                updated_fields: Object.keys(safeUpdateData),
                is_preset: true
            }, currentUser.user_id);

            return preset;
        });
    } catch (error) {
        console.error('Error updating contract line preset:', error);
        if (error instanceof Error) {
            if (error.message.includes('not found')) {
                throw new Error(`Contract Line Preset with ID ${presetId} not found during update.`);
            }
            throw error;
        }
        throw new Error(`Failed to update contract line preset ${presetId}: ${error}`);
    }
}

export async function deleteContractLinePreset(presetId: string): Promise<void> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error('No authenticated user found');
        }

        const { knex, tenant } = await createTenantKnex();
        if (!tenant) {
            throw new Error("tenant context not found");
        }

        await withTransaction(knex, async (trx: Knex.Transaction) => {
            if (!await hasPermission(currentUser, 'billing', 'delete', trx)) {
                throw new Error('Permission denied: Cannot delete contract line presets');
            }

            await ContractLinePreset.delete(trx, presetId);
        });
    } catch (error) {
        console.error('Error deleting contract line preset:', error);
        if (error instanceof Error) {
            throw error;
        }
        throw new Error(`Failed to delete contract line preset: ${error}`);
    }
}

/**
 * Get services for a contract line preset
 */
export async function getContractLinePresetServices(presetId: string): Promise<IContractLinePresetService[]> {
    try {
        const isBypass = process.env.E2E_AUTH_BYPASS === 'true';
        const currentUser = isBypass ? ({} as any) : await getCurrentUser();
        if (!currentUser && !isBypass) {
            throw new Error('No authenticated user found');
        }

        const { knex, tenant } = await createTenantKnex();
        if (!tenant) {
            throw new Error("tenant context not found");
        }

        return await withTransaction(knex, async (trx: Knex.Transaction) => {
            if (!isBypass && !await hasPermission(currentUser, 'billing', 'read', trx)) {
                throw new Error('Permission denied: Cannot read contract line preset services');
            }

            const services = await ContractLinePresetService.getByPresetId(trx, presetId);
            return services;
        });
    } catch (error) {
        console.error(`Error fetching services for preset ${presetId}:`, error);
        if (error instanceof Error) {
            throw error;
        }
        throw new Error(`Failed to fetch services for preset ${presetId}: ${error}`);
    }
}

/**
 * Update services for a contract line preset
 */
export async function updateContractLinePresetServices(
    presetId: string,
    services: Omit<IContractLinePresetService, 'tenant' | 'created_at' | 'updated_at'>[]
): Promise<IContractLinePresetService[]> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error('No authenticated user found');
        }

        const { knex, tenant } = await createTenantKnex();
        if (!tenant) {
            throw new Error("tenant context not found");
        }

        return await withTransaction(knex, async (trx: Knex.Transaction) => {
            if (!await hasPermission(currentUser, 'billing', 'update', trx)) {
                throw new Error('Permission denied: Cannot update contract line preset services');
            }

            const updatedServices = await ContractLinePresetService.updateForPreset(trx, presetId, services);
            return updatedServices;
        });
    } catch (error) {
        console.error(`Error updating services for preset ${presetId}:`, error);
        if (error instanceof Error) {
            throw error;
        }
        throw new Error(`Failed to update services for preset ${presetId}: ${error}`);
    }
}

/**
 * Get fixed config for a contract line preset
 */
export async function getContractLinePresetFixedConfig(presetId: string): Promise<IContractLinePresetFixedConfig | null> {
    try {
        const isBypass = process.env.E2E_AUTH_BYPASS === 'true';
        const currentUser = isBypass ? ({} as any) : await getCurrentUser();
        if (!currentUser && !isBypass) {
            throw new Error('No authenticated user found');
        }

        const { knex, tenant } = await createTenantKnex();
        if (!tenant) {
            throw new Error("tenant context not found");
        }

        return await withTransaction(knex, async (trx: Knex.Transaction) => {
            if (!isBypass && !await hasPermission(currentUser, 'billing', 'read', trx)) {
                throw new Error('Permission denied: Cannot read contract line preset fixed config');
            }

            const config = await ContractLinePresetFixedConfig.getByPresetId(trx, presetId);
            return config;
        });
    } catch (error) {
        console.error(`Error fetching fixed config for preset ${presetId}:`, error);
        if (error instanceof Error) {
            throw error;
        }
        throw new Error(`Failed to fetch fixed config for preset ${presetId}: ${error}`);
    }
}

/**
 * Update fixed config for a contract line preset
 */
export async function updateContractLinePresetFixedConfig(
    presetId: string,
    configData: Omit<IContractLinePresetFixedConfig, 'preset_id' | 'tenant' | 'created_at' | 'updated_at'>
): Promise<IContractLinePresetFixedConfig> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error('No authenticated user found');
        }

        const { knex, tenant } = await createTenantKnex();
        if (!tenant) {
            throw new Error("tenant context not found");
        }

        return await withTransaction(knex, async (trx: Knex.Transaction) => {
            if (!await hasPermission(currentUser, 'billing', 'update', trx)) {
                throw new Error('Permission denied: Cannot update contract line preset fixed config');
            }

            const config = await ContractLinePresetFixedConfig.upsert(trx, presetId, configData);
            return config;
        });
    } catch (error) {
        console.error(`Error updating fixed config for preset ${presetId}:`, error);
        if (error instanceof Error) {
            throw error;
        }
        throw new Error(`Failed to update fixed config for preset ${presetId}: ${error}`);
    }
}
