// server/src/lib/actions/contractLinePresetActions.ts
'use server'
import ContractLinePreset from 'server/src/lib/models/contractLinePreset';
import ContractLinePresetService from 'server/src/lib/models/contractLinePresetService';
import ContractLinePresetFixedConfig from 'server/src/lib/models/contractLinePresetFixedConfig';
import { IContractLinePreset, IContractLinePresetService, IContractLinePresetFixedConfig, IContractLine, IContractLineService, IContractLineFixedConfig } from 'server/src/interfaces/billing.interfaces';
import { createTenantKnex } from 'server/src/lib/db';
import { Knex } from 'knex';
import { withTransaction } from '@alga-psa/shared/db';
import { getCurrentUser } from './user-actions/userActions';
import { hasPermission } from 'server/src/lib/auth/rbac';
import { analytics } from '../analytics/posthog';
import { AnalyticsEvents } from '../analytics/events';
import ContractLine from 'server/src/lib/models/contractLine';
import ContractLineFixedConfig from 'server/src/lib/models/contractLineFixedConfig';

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

/**
 * Copy a contract line preset into an actual contract line for a contract
 * This creates a new contract line based on the preset's data and links it to the specified contract
 */
export async function copyPresetToContractLine(
    contractId: string,
    presetId: string,
    overrides?: {
        base_rate?: number | null;
    }
): Promise<string> {
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
                throw new Error('Permission denied: Cannot create contract lines from presets');
            }

            // 1. Fetch the preset
            const preset = await ContractLinePreset.findById(trx, presetId);
            if (!preset) {
                throw new Error(`Contract line preset ${presetId} not found`);
            }

            // 2. Create the contract line
            const contractLineData: Omit<IContractLine, 'contract_line_id' | 'tenant' | 'created_at' | 'updated_at'> = {
                contract_line_name: preset.preset_name,
                contract_line_type: preset.contract_line_type,
                billing_frequency: preset.billing_frequency,
                service_category: undefined, // Presets don't have service_category
            };

            const contractLine = await ContractLine.create(trx, contractLineData);

            // 3. Add the contract line to the contract by directly inserting into the mapping table
            // We can't use addContractLine() because it creates its own transaction and session
            const countResult = await trx('contract_line_mappings')
                .where({ tenant, contract_id: contractId })
                .count<{ count: string | number }>('contract_line_id as count')
                .first();

            const existingCount =
                countResult?.count != null
                    ? typeof countResult.count === 'string'
                        ? Number.parseInt(countResult.count, 10)
                        : Number(countResult.count)
                    : 0;

            await trx('contract_line_mappings').insert({
                tenant,
                contract_id: contractId,
                contract_line_id: contractLine.contract_line_id,
                display_order: existingCount,
                custom_rate: null,
                created_at: trx.fn.now()
            });

            // 4. Copy services
            const presetServices = await ContractLinePresetService.getByPresetId(trx, presetId);
            if (presetServices.length > 0) {
                for (const presetService of presetServices) {
                    await trx('contract_line_services').insert({
                        contract_line_id: contractLine.contract_line_id,
                        service_id: presetService.service_id,
                        quantity: presetService.quantity || 1,
                        custom_rate: null, // Services use their default rates unless overridden
                        tenant,
                        created_at: trx.fn.now(),
                        updated_at: trx.fn.now()
                    });
                }
            }

            // 5. Copy type-specific config
            if (preset.contract_line_type === 'Fixed') {
                const presetFixedConfig = await ContractLinePresetFixedConfig.getByPresetId(trx, presetId);
                if (presetFixedConfig) {
                    const fixedConfigData: Omit<IContractLineFixedConfig, 'contract_line_id' | 'tenant' | 'created_at' | 'updated_at'> = {
                        base_rate: overrides?.base_rate !== undefined ? overrides.base_rate : presetFixedConfig.base_rate,
                        enable_proration: presetFixedConfig.enable_proration,
                        billing_cycle_alignment: presetFixedConfig.billing_cycle_alignment,
                    };
                    await ContractLineFixedConfig.upsert(trx, contractLine.contract_line_id, fixedConfigData);
                }
            }

            // Track analytics
            analytics.capture(AnalyticsEvents.BILLING_RULE_CREATED, {
                contract_line_id: contractLine.contract_line_id,
                contract_line_name: contractLine.contract_line_name,
                contract_line_type: contractLine.contract_line_type,
                copied_from_preset: presetId,
                contract_id: contractId
            }, currentUser.user_id);

            return contractLine.contract_line_id;
        });
    } catch (error) {
        console.error(`Error copying preset ${presetId} to contract ${contractId}:`, error);
        if (error instanceof Error) {
            throw error;
        }
        throw new Error(`Failed to copy preset to contract line: ${error}`);
    }
}
