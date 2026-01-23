// server/src/lib/actions/contractLinePresetActions.ts
'use server'
import { v4 as uuidv4 } from 'uuid';
import ContractLinePreset from '../models/contractLinePreset';
import ContractLinePresetService from '../models/contractLinePresetService';
import ContractLinePresetFixedConfig from '../models/contractLinePresetFixedConfig';
import { IContractLinePreset, IContractLinePresetService, IContractLinePresetFixedConfig, IContractLine, IContractLineService, IContractLineFixedConfig } from '@alga-psa/types';
import { createTenantKnex } from '@alga-psa/db';
import { Knex } from 'knex';
import { withTransaction } from '@alga-psa/db';
import { getCurrentUserAsync, hasPermissionAsync, getSessionAsync, getAnalyticsAsync } from '../lib/authHelpers';




import ContractLine from '../models/contractLine';
import ContractLineFixedConfig from '../models/contractLineFixedConfig';
import { ContractLineServiceConfigurationService } from '../services/contractLineServiceConfigurationService';
import { IContractLineServiceConfiguration } from '@alga-psa/types';

export async function getContractLinePresets(): Promise<IContractLinePreset[]> {
    try {
        const isBypass = process.env.E2E_AUTH_BYPASS === 'true';
        const currentUser = isBypass ? ({} as any) : await getCurrentUserAsync();
        if (!currentUser && !isBypass) {
            throw new Error('No authenticated user found');
        }

        // Explicitly pass tenant to ensure context is set (dynamic imports can lose AsyncLocalStorage context)
        const { knex, tenant } = await createTenantKnex(currentUser?.tenant);
        if (!tenant) {
            throw new Error("tenant context not found");
        }

        return await withTransaction(knex, async (trx: Knex.Transaction) => {
            if (!isBypass && !await hasPermissionAsync(currentUser, 'billing', 'read')) {
                throw new Error('Permission denied: Cannot read contract line presets');
            }

            const presets = await ContractLinePreset.getAll(trx, tenant);
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
        const currentUser = isBypass ? ({} as any) : await getCurrentUserAsync();
        if (!currentUser && !isBypass) {
            throw new Error('No authenticated user found');
        }

        const { knex, tenant } = await createTenantKnex(currentUser?.tenant);
        if (!tenant) {
            throw new Error("tenant context not found");
        }

        return await withTransaction(knex, async (trx: Knex.Transaction) => {
            if (!isBypass && !await hasPermissionAsync(currentUser, 'billing', 'read')) {
                throw new Error('Permission denied: Cannot read contract line presets');
            }

            const preset = await ContractLinePreset.findById(trx, tenant, presetId);
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
        const currentUser = await getCurrentUserAsync();
        if (!currentUser) {
            throw new Error('No authenticated user found');
        }

        const { knex, tenant } = await createTenantKnex(currentUser.tenant);
        if (!tenant) {
            throw new Error("tenant context not found");
        }

        return await withTransaction(knex, async (trx: Knex.Transaction) => {
            if (!await hasPermissionAsync(currentUser, 'billing', 'create')) {
                throw new Error('Permission denied: Cannot create contract line presets');
            }

            const { tenant: _, ...safePresetData } = presetData as any;
            const preset = await ContractLinePreset.create(trx, tenant, safePresetData);

            // Track analytics
            const { analytics, AnalyticsEvents } = await getAnalyticsAsync();
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
        const currentUser = await getCurrentUserAsync();
        if (!currentUser) {
            throw new Error('No authenticated user found');
        }

        const { knex, tenant } = await createTenantKnex(currentUser.tenant);
        if (!tenant) {
            throw new Error("tenant context not found");
        }

        return await withTransaction(knex, async (trx: Knex.Transaction) => {
            if (!await hasPermissionAsync(currentUser, 'billing', 'update')) {
                throw new Error('Permission denied: Cannot update contract line presets');
            }

            const existingPreset = await ContractLinePreset.findById(trx, tenant, presetId);
            if (!existingPreset) {
                throw new Error(`Contract Line Preset with ID ${presetId} not found.`);
            }

            const { tenant: _, preset_id: __, ...safeUpdateData } = updateData as any;
            const preset = await ContractLinePreset.update(trx, tenant, presetId, safeUpdateData);

            // Track analytics
            const { analytics, AnalyticsEvents } = await getAnalyticsAsync();
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
        const currentUser = await getCurrentUserAsync();
        if (!currentUser) {
            throw new Error('No authenticated user found');
        }

        const { knex, tenant } = await createTenantKnex(currentUser.tenant);
        if (!tenant) {
            throw new Error("tenant context not found");
        }

        await withTransaction(knex, async (trx: Knex.Transaction) => {
            if (!await hasPermissionAsync(currentUser, 'billing', 'delete')) {
                throw new Error('Permission denied: Cannot delete contract line presets');
            }

            await ContractLinePreset.delete(trx, tenant, presetId);
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
        const currentUser = isBypass ? ({} as any) : await getCurrentUserAsync();
        if (!currentUser && !isBypass) {
            throw new Error('No authenticated user found');
        }

        const { knex, tenant } = await createTenantKnex(currentUser?.tenant);
        if (!tenant) {
            throw new Error("tenant context not found");
        }

        return await withTransaction(knex, async (trx: Knex.Transaction) => {
            if (!isBypass && !await hasPermissionAsync(currentUser, 'billing', 'read')) {
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
        const currentUser = await getCurrentUserAsync();
        if (!currentUser) {
            throw new Error('No authenticated user found');
        }

        const { knex, tenant } = await createTenantKnex(currentUser.tenant);
        if (!tenant) {
            throw new Error("tenant context not found");
        }

        return await withTransaction(knex, async (trx: Knex.Transaction) => {
            if (!await hasPermissionAsync(currentUser, 'billing', 'update')) {
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
        const currentUser = isBypass ? ({} as any) : await getCurrentUserAsync();
        if (!currentUser && !isBypass) {
            throw new Error('No authenticated user found');
        }

        const { knex, tenant } = await createTenantKnex(currentUser?.tenant);
        if (!tenant) {
            throw new Error("tenant context not found");
        }

        return await withTransaction(knex, async (trx: Knex.Transaction) => {
            if (!isBypass && !await hasPermissionAsync(currentUser, 'billing', 'read')) {
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
        const currentUser = await getCurrentUserAsync();
        if (!currentUser) {
            throw new Error('No authenticated user found');
        }

        const { knex, tenant } = await createTenantKnex(currentUser.tenant);
        if (!tenant) {
            throw new Error("tenant context not found");
        }

        return await withTransaction(knex, async (trx: Knex.Transaction) => {
            if (!await hasPermissionAsync(currentUser, 'billing', 'update')) {
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
        services?: Record<string, { quantity?: number; custom_rate?: number }>;
        minimum_billable_time?: number;
        round_up_to_nearest?: number;
    }
): Promise<string> {
    try {
        const currentUser = await getCurrentUserAsync();
        if (!currentUser) {
            throw new Error('No authenticated user found');
        }

        const { knex, tenant } = await createTenantKnex(currentUser.tenant);
        if (!tenant) {
            throw new Error("tenant context not found");
        }

        // Capture tenant as a string for use in the transaction
        const tenantId: string = tenant;

        return await withTransaction(knex, async (trx: Knex.Transaction) => {
            if (!await hasPermissionAsync(currentUser, 'billing', 'create')) {
                throw new Error('Permission denied: Cannot create contract lines from presets');
            }

            // 1. Fetch the preset
            const preset = await ContractLinePreset.findById(trx, tenant, presetId);
            if (!preset) {
                throw new Error(`Contract line preset ${presetId} not found`);
            }
            console.log(`[copyPresetToContractLine] Preset data:`, {
                preset_id: preset.preset_id,
                preset_name: preset.preset_name,
                minimum_billable_time: preset.minimum_billable_time,
                round_up_to_nearest: preset.round_up_to_nearest,
                overrides: overrides
            });

            // 2. Create the contract line
            // Use override if provided, otherwise use preset value, otherwise use default
            const minBillableTime = overrides?.minimum_billable_time !== undefined
                ? overrides.minimum_billable_time
                : preset.minimum_billable_time !== undefined && preset.minimum_billable_time !== null
                    ? preset.minimum_billable_time
                    : 15;

            const roundUpToNearest = overrides?.round_up_to_nearest !== undefined
                ? overrides.round_up_to_nearest
                : preset.round_up_to_nearest !== undefined && preset.round_up_to_nearest !== null
                    ? preset.round_up_to_nearest
                    : 15;

            const contractLineData: Omit<IContractLine, 'contract_line_id' | 'tenant' | 'created_at' | 'updated_at'> = {
                contract_line_name: preset.preset_name,
                contract_line_type: preset.contract_line_type,
                billing_frequency: preset.billing_frequency,
                service_category: undefined, // Presets don't have service_category
                is_custom: false, // Contract lines created from presets are not custom
                // Add hourly-specific fields if this is an hourly contract line
                ...(preset.contract_line_type === 'Hourly' ? {
                    minimum_billable_time: minBillableTime,
                    round_up_to_nearest: roundUpToNearest,
                } : {}),
            };

            const contractLine = await ContractLine.create(trx, contractLineData);

            if (!contractLine.contract_line_id) {
                throw new Error('Failed to create contract line: missing contract_line_id');
            }

            const contractLineId = contractLine.contract_line_id;

            // 3. Link the contract line to the contract by updating contract_lines directly
            // After migration 20251028090000, data is stored directly in contract_lines
            const countResult = await trx('contract_lines')
                .where({ tenant: tenantId, contract_id: contractId })
                .count<{ count: string | number }>('contract_line_id as count')
                .first();

            const existingCount =
                countResult?.count != null
                    ? typeof countResult.count === 'string'
                        ? Number.parseInt(countResult.count, 10)
                        : Number(countResult.count)
                    : 0;

            await trx('contract_lines')
                .where({ tenant: tenantId, contract_line_id: contractLineId })
                .update({
                    contract_id: contractId,
                    display_order: existingCount,
                    custom_rate: null,
                    updated_at: trx.fn.now()
                });

            // 4. Copy services and their configurations
            const presetServices = await ContractLinePresetService.getByPresetId(trx, presetId);
            console.log(`[copyPresetToContractLine] Found ${presetServices.length} services for preset ${presetId}:`, presetServices);

            if (presetServices.length > 0) {
                const configService = new ContractLineServiceConfigurationService(trx, tenantId);

                for (const presetService of presetServices) {
                    const serviceOverride = overrides?.services?.[presetService.service_id];
                    console.log(`[copyPresetToContractLine] Copying service ${presetService.service_id}, override:`, serviceOverride);

                    // Insert into contract_line_services table
                    await trx('contract_line_services').insert({
                        contract_line_id: contractLineId,
                        service_id: presetService.service_id,
                        tenant: tenantId
                    });

                    console.log(`[copyPresetToContractLine] Successfully inserted service ${presetService.service_id} for contract line ${contractLineId}`);

                    // Determine configuration type based on contract line type
                    let configurationType: 'Fixed' | 'Hourly' | 'Usage' | 'Bucket' = preset.contract_line_type as any;

                    // Create the base configuration
                    const baseConfig: Omit<IContractLineServiceConfiguration, 'config_id' | 'created_at' | 'updated_at'> = {
                        contract_line_id: contractLineId,
                        service_id: presetService.service_id,
                        configuration_type: configurationType,
                        custom_rate: serviceOverride?.custom_rate ?? presetService.custom_rate ?? undefined,
                        quantity: serviceOverride?.quantity ?? presetService.quantity ?? 1,
                        instance_name: undefined,
                        tenant: tenantId
                    };

                    // Create type-specific config based on contract line type
                    let typeConfig: any = {};

                    if (configurationType === 'Hourly') {
                        // Use override if provided, otherwise use preset value, otherwise use default of 15
                        const minBillableTime = overrides?.minimum_billable_time !== undefined
                            ? overrides.minimum_billable_time
                            : preset.minimum_billable_time !== undefined && preset.minimum_billable_time !== null
                                ? preset.minimum_billable_time
                                : 15;

                        const roundUpToNearest = overrides?.round_up_to_nearest !== undefined
                            ? overrides.round_up_to_nearest
                            : preset.round_up_to_nearest !== undefined && preset.round_up_to_nearest !== null
                                ? preset.round_up_to_nearest
                                : 15;

                        typeConfig = {
                            hourly_rate: baseConfig.custom_rate,
                            minimum_billable_time: minBillableTime,
                            round_up_to_nearest: roundUpToNearest
                        };
                    } else if (configurationType === 'Usage') {
                        typeConfig = {
                            unit_of_measure: presetService.unit_of_measure || 'unit',
                            base_rate: baseConfig.custom_rate,
                            enable_tiered_pricing: false,
                            minimum_usage: undefined
                        };
                    }

                    // Create the configuration record
                    await configService.createConfiguration(baseConfig, typeConfig);

                    console.log(`[copyPresetToContractLine] Successfully created configuration for service ${presetService.service_id}`);

                    // Handle bucket overlay if present
                    if (presetService.bucket_total_minutes != null && presetService.bucket_overage_rate != null) {
                        console.log(`[copyPresetToContractLine] Creating bucket overlay for service ${presetService.service_id}`);

                        const bucketConfigId = uuidv4();

                        // Create bucket service configuration
                        const bucketConfig: Omit<IContractLineServiceConfiguration, 'config_id' | 'created_at' | 'updated_at'> = {
                            contract_line_id: contractLineId,
                            service_id: presetService.service_id,
                            configuration_type: 'Bucket',
                            custom_rate: undefined,
                            quantity: undefined,
                            instance_name: undefined,
                            tenant: tenantId
                        };

                        // Create bucket-specific config matching the contract line's billing frequency
                        const bucketTypeConfig = {
                            total_minutes: Math.max(0, Math.round(presetService.bucket_total_minutes)),
                            billing_period: contractLine.billing_frequency,
                            overage_rate: Math.max(0, Math.round(presetService.bucket_overage_rate)),
                            allow_rollover: presetService.bucket_allow_rollover ?? false
                        };

                        await configService.createConfiguration(bucketConfig, bucketTypeConfig);

                        console.log(`[copyPresetToContractLine] Successfully created bucket configuration for service ${presetService.service_id}`);
                    }
                }
            } else {
                console.log(`[copyPresetToContractLine] No services found for preset ${presetId}, skipping service copy`);
            }

            // 5. Copy type-specific config
            if (preset.contract_line_type === 'Fixed') {
                const presetFixedConfig = await ContractLinePresetFixedConfig.getByPresetId(trx, presetId);
                if (presetFixedConfig) {
                    const fixedConfigData: Omit<IContractLineFixedConfig, 'created_at' | 'updated_at'> = {
                        contract_line_id: contractLineId,
                        base_rate: overrides?.base_rate !== undefined ? overrides.base_rate : presetFixedConfig.base_rate,
                        enable_proration: presetFixedConfig.enable_proration,
                        billing_cycle_alignment: presetFixedConfig.billing_cycle_alignment,
                        tenant: tenantId
                    };
                    const fixedConfigModel = new ContractLineFixedConfig(trx, tenantId);
                    await fixedConfigModel.upsert(fixedConfigData);
                }
            }

            // Track analytics
            const { analytics, AnalyticsEvents } = await getAnalyticsAsync();
            analytics.capture(AnalyticsEvents.BILLING_RULE_CREATED, {
                contract_line_id: contractLineId,
                contract_line_name: contractLine.contract_line_name,
                contract_line_type: contractLine.contract_line_type,
                copied_from_preset: presetId,
                contract_id: contractId
            }, currentUser.user_id);

            return contractLineId;
        });
    } catch (error) {
        console.error(`Error copying preset ${presetId} to contract ${contractId}:`, error);
        if (error instanceof Error) {
            throw error;
        }
        throw new Error(`Failed to copy preset to contract line: ${error}`);
    }
}

/**
 * Service configuration for custom contract line creation
 */
export interface CustomContractLineServiceConfig {
    service_id: string;
    quantity?: number;
    custom_rate?: number;  // Rate in cents
    unit_of_measure?: string;  // For usage-based services
    bucket_overlay?: {
        total_minutes: number;
        overage_rate: number;
        allow_rollover: boolean;
        billing_period: 'weekly' | 'monthly';
    } | null;
}

/**
 * Input data for creating a custom contract line
 */
export interface CreateCustomContractLineInput {
    contract_line_name: string;
    contract_line_type: 'Fixed' | 'Hourly' | 'Usage';
    billing_frequency: string;
    billing_timing?: 'arrears' | 'advance';
    services: CustomContractLineServiceConfig[];
    // Fixed-specific config
    base_rate?: number | null;  // For Fixed type, overall base rate
    enable_proration?: boolean;
    // Hourly-specific config
    minimum_billable_time?: number;
    round_up_to_nearest?: number;
}

/**
 * Create a custom contract line directly for a contract (without using a preset)
 * This creates a new contract line with the provided configuration and links it to the specified contract
 */
export async function createCustomContractLine(
    contractId: string,
    input: CreateCustomContractLineInput
): Promise<string> {
    try {
        const currentUser = await getCurrentUserAsync();
        if (!currentUser) {
            throw new Error('No authenticated user found');
        }

        const { knex, tenant } = await createTenantKnex(currentUser.tenant);
        if (!tenant) {
            throw new Error("tenant context not found");
        }

        const tenantId: string = tenant;

        return await withTransaction(knex, async (trx: Knex.Transaction) => {
            if (!await hasPermissionAsync(currentUser, 'billing', 'create')) {
                throw new Error('Permission denied: Cannot create contract lines');
            }

            // 1. Validate the input
            if (!input.contract_line_name?.trim()) {
                throw new Error('Contract line name is required');
            }

            if (!input.services || input.services.length === 0) {
                throw new Error('At least one service is required');
            }

            // 2. Create the contract line
            const minBillableTime = input.contract_line_type === 'Hourly'
                ? (input.minimum_billable_time ?? 15)
                : undefined;

            const roundUpToNearest = input.contract_line_type === 'Hourly'
                ? (input.round_up_to_nearest ?? 15)
                : undefined;

            const contractLineData: Omit<IContractLine, 'contract_line_id' | 'tenant' | 'created_at' | 'updated_at'> = {
                contract_line_name: input.contract_line_name,
                contract_line_type: input.contract_line_type,
                billing_frequency: input.billing_frequency,
                billing_timing: input.billing_timing ?? 'advance',
                service_category: undefined,
                is_custom: true,  // Mark as custom since it's not from a preset
                ...(input.contract_line_type === 'Hourly' ? {
                    minimum_billable_time: minBillableTime,
                    round_up_to_nearest: roundUpToNearest,
                } : {}),
            };

            const contractLine = await ContractLine.create(trx, contractLineData);

            if (!contractLine.contract_line_id) {
                throw new Error('Failed to create contract line: missing contract_line_id');
            }

            const contractLineId = contractLine.contract_line_id;

            // 3. Link the contract line to the contract
            const countResult = await trx('contract_lines')
                .where({ tenant: tenantId, contract_id: contractId })
                .count<{ count: string | number }>('contract_line_id as count')
                .first();

            const existingCount =
                countResult?.count != null
                    ? typeof countResult.count === 'string'
                        ? Number.parseInt(countResult.count, 10)
                        : Number(countResult.count)
                    : 0;

            await trx('contract_lines')
                .where({ tenant: tenantId, contract_line_id: contractLineId })
                .update({
                    contract_id: contractId,
                    display_order: existingCount,
                    custom_rate: null,
                    updated_at: trx.fn.now()
                });

            // 4. Create service configurations
            const configService = new ContractLineServiceConfigurationService(trx, tenantId);

            for (const serviceConfig of input.services) {
                // Insert into contract_line_services table
                await trx('contract_line_services').insert({
                    contract_line_id: contractLineId,
                    service_id: serviceConfig.service_id,
                    tenant: tenantId
                });

                // Create the base configuration
                const baseConfig: Omit<IContractLineServiceConfiguration, 'config_id' | 'created_at' | 'updated_at'> = {
                    contract_line_id: contractLineId,
                    service_id: serviceConfig.service_id,
                    configuration_type: input.contract_line_type,
                    custom_rate: serviceConfig.custom_rate ?? undefined,
                    quantity: serviceConfig.quantity ?? 1,
                    instance_name: undefined,
                    tenant: tenantId
                };

                // Create type-specific config based on contract line type
                let typeConfig: any = {};

                if (input.contract_line_type === 'Hourly') {
                    typeConfig = {
                        hourly_rate: serviceConfig.custom_rate,
                        minimum_billable_time: minBillableTime,
                        round_up_to_nearest: roundUpToNearest
                    };
                } else if (input.contract_line_type === 'Usage') {
                    typeConfig = {
                        unit_of_measure: serviceConfig.unit_of_measure || 'unit',
                        base_rate: serviceConfig.custom_rate,
                        enable_tiered_pricing: false,
                        minimum_usage: undefined
                    };
                }

                // Create the configuration record
                await configService.createConfiguration(baseConfig, typeConfig);

                // Handle bucket overlay if present
                if (serviceConfig.bucket_overlay &&
                    serviceConfig.bucket_overlay.total_minutes != null &&
                    serviceConfig.bucket_overlay.overage_rate != null) {

                    const bucketConfig: Omit<IContractLineServiceConfiguration, 'config_id' | 'created_at' | 'updated_at'> = {
                        contract_line_id: contractLineId,
                        service_id: serviceConfig.service_id,
                        configuration_type: 'Bucket',
                        custom_rate: undefined,
                        quantity: undefined,
                        instance_name: undefined,
                        tenant: tenantId
                    };

                    const bucketTypeConfig = {
                        total_minutes: Math.max(0, Math.round(serviceConfig.bucket_overlay.total_minutes)),
                        billing_period: serviceConfig.bucket_overlay.billing_period || input.billing_frequency,
                        overage_rate: Math.max(0, Math.round(serviceConfig.bucket_overlay.overage_rate)),
                        allow_rollover: serviceConfig.bucket_overlay.allow_rollover ?? false
                    };

                    await configService.createConfiguration(bucketConfig, bucketTypeConfig);
                }
            }

            // 5. Create type-specific config for Fixed type
            if (input.contract_line_type === 'Fixed') {
                const fixedConfigData: Omit<IContractLineFixedConfig, 'created_at' | 'updated_at'> = {
                    contract_line_id: contractLineId,
                    base_rate: input.base_rate ?? null,
                    enable_proration: input.enable_proration ?? false,
                    billing_cycle_alignment: 'start',
                    tenant: tenantId
                };
                const fixedConfigModel = new ContractLineFixedConfig(trx, tenantId);
                await fixedConfigModel.upsert(fixedConfigData);
            }

            // Track analytics
            const { analytics, AnalyticsEvents } = await getAnalyticsAsync();
            analytics.capture(AnalyticsEvents.BILLING_RULE_CREATED, {
                contract_line_id: contractLineId,
                contract_line_name: contractLine.contract_line_name,
                contract_line_type: contractLine.contract_line_type,
                is_custom: true,
                contract_id: contractId
            }, currentUser.user_id);

            return contractLineId;
        });
    } catch (error) {
        console.error(`Error creating custom contract line for contract ${contractId}:`, error);
        if (error instanceof Error) {
            throw error;
        }
        throw new Error(`Failed to create custom contract line: ${error}`);
    }
}
