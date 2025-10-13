// server/src/lib/actions/contractLineActions.ts
'use server'
import ContractLine from 'server/src/lib/models/contractLine';
import { IContractLine, IContractLineFixedConfig } from 'server/src/interfaces/billing.interfaces'; // Added IContractLineFixedConfig
import { createTenantKnex } from 'server/src/lib/db';
import { Knex } from 'knex'; // Import Knex type
import { ContractLineServiceConfigurationService } from 'server/src/lib/services/contractLineServiceConfigurationService';
import { IContractLineServiceFixedConfig } from 'server/src/interfaces/contractLineServiceConfiguration.interfaces'; // This might be removable if not used elsewhere after refactor
import ContractLineFixedConfig from 'server/src/lib/models/contractLineFixedConfig'; // Added import for new model
import { withTransaction } from '@alga-psa/shared/db';
import { getCurrentUser } from './user-actions/userActions';
import { hasPermission } from 'server/src/lib/auth/rbac';
import { analytics } from '../analytics/posthog';
import { AnalyticsEvents } from '../analytics/events';

export async function getContractLines(): Promise<IContractLine[]> {
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
            if (!await hasPermission(currentUser, 'billing', 'read', trx)) {
                throw new Error('Permission denied: Cannot read contract lines');
            }

            const contractLines = await ContractLine.getAll(trx);
            return contractLines;
        });
    } catch (error) {
        console.error('Error fetching contract lines:', error);
        if (error instanceof Error) {
            throw error; // Preserve specific error messages
        }
        throw new Error(`Failed to fetch client contract lines: ${error}`);
    }
}

// New function to get a single contract line by ID
export async function getContractLineById(contractLineId: string): Promise<IContractLine | null> {
    let tenant_copy: string = '';
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error('No authenticated user found');
        }

        const { knex, tenant } = await createTenantKnex();
        if (!tenant) {
            throw new Error("tenant context not found");
        }
        tenant_copy = tenant;

        return await withTransaction(knex, async (trx: Knex.Transaction) => {
            if (!await hasPermission(currentUser, 'billing', 'read', trx)) {
                throw new Error('Permission denied: Cannot read contract lines');
            }

            // Assuming the ContractLine model has a method like findById
            // This might need adjustment based on the actual model implementation
            // It should ideally fetch the base contract line and potentially join/fetch config details
            const contractLine = await ContractLine.findById(trx, contractLineId);
            return contractLine; // The model method should return the contract line with necessary fields
        });
    } catch (error) {
        console.error(`Error fetching contract line with ID ${contractLineId}:`, error);
        if (error instanceof Error) {
            // Handle specific errors like 'not found' if the model throws them
            if (error.message.includes('not found')) { // Example check
                return null;
            }
            throw error;
        }
        throw new Error(`Failed to fetch contract line ${contractLineId} in tenant ${tenant_copy}: ${error}`);
    }
}

export async function createContractLine(
    contractLineData: Omit<IContractLine, 'contract_line_id'>
): Promise<IContractLine> {
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
                throw new Error('Permission denied: Cannot create contract lines');
            }

            // Remove tenant field if present in contractLineData to prevent override
            const { tenant: _, ...safeContractLineData } = contractLineData;
            const contractLine = await ContractLine.create(trx, safeContractLineData);

            // Track analytics
            analytics.capture(AnalyticsEvents.BILLING_RULE_CREATED, {
                contract_line_id: contractLine.contract_line_id,
                contract_line_name: contractLine.contract_line_name,
                contract_line_type: contractLine.contract_line_type,
                hourly_rate: contractLine.hourly_rate,
                minimum_billable_time: contractLine.minimum_billable_time,
                is_sla_contract_line: (contractLine as any).is_sla_contract_line || false
            }, currentUser.user_id);

            return contractLine;
        });
    } catch (error) {
        console.error('Error creating contract line:', error);
        if (error instanceof Error) {
            throw error; // Preserve specific error messages
        }
        throw new Error(`Failed to create contract line: ${error}`);
    }
}

export async function updateContractLine(
    contractLineId: string,
    updateData: Partial<IContractLine>
): Promise<IContractLine> {
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
                throw new Error('Permission denied: Cannot update contract lines');
            }

            // Fetch the existing contract line to check its type
            const existingContractLine = await ContractLine.findById(trx, contractLineId);
            if (!existingContractLine) {
                // Handle case where contract line is not found before update attempt
                throw new Error(`Contract Line with ID ${contractLineId} not found.`);
            }

            // Remove tenant field if present in updateData to prevent override
            // Use Object.assign to create a mutable copy if needed, or rely on delete below
            const { tenant: _, ...safeUpdateData } = updateData;

            // If the contract line is hourly, remove the per-service fields from the update data
            if (existingContractLine.contract_line_type === 'Hourly') {
                delete safeUpdateData.hourly_rate;
                delete safeUpdateData.minimum_billable_time;
                delete safeUpdateData.round_up_to_nearest;
                // Optional: Log that fields were removed for debugging
                // console.log(`Hourly contract line update: Removed per-service fields for contract line ${contractLineId}`);
            }

            // Proceed with the update using the potentially modified data
            // Ensure ContractLine.update handles empty updateData gracefully if all fields were removed
            const contractLine = await ContractLine.update(trx, contractLineId, safeUpdateData);

            // Track analytics
            analytics.capture(AnalyticsEvents.BILLING_RULE_UPDATED, {
                contract_line_id: contractLine.contract_line_id,
                contract_line_name: contractLine.contract_line_name,
                contract_line_type: contractLine.contract_line_type,
                updated_fields: Object.keys(safeUpdateData)
            }, currentUser.user_id);

            return contractLine;
        });
    } catch (error) {
        console.error('Error updating contract line:', error);
        if (error instanceof Error) {
            // Re-throw specific errors like 'not found' if they weren't caught above
            if (error.message.includes('not found')) {
                 throw new Error(`Contract Line with ID ${contractLineId} not found during update.`);
            }
            throw error; // Preserve other specific error messages
        }
        throw new Error(`Failed to update contract line ${contractLineId}: ${error}`);
    }
}

export async function deleteContractLine(contractLineId: string): Promise<void> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error('No authenticated user found');
        }

        const { knex, tenant } = await createTenantKnex(); // Capture knex instance here
        if (!tenant) {
            throw new Error("tenant context not found");
        }

        await withTransaction(knex, async (trx: Knex.Transaction) => {
            if (!await hasPermission(currentUser, 'billing', 'delete', trx)) {
                throw new Error('Permission denied: Cannot delete contract lines');
            }

            // Check if contract line is in use by clients before attempting to delete
            const isInUse = await ContractLine.isInUse(trx, contractLineId); // This check might be redundant now, but keep for clarity or remove if desired
            if (isInUse) {
                 // This specific error might be superseded by the detailed one below if the FK constraint is hit
                 // Consider if this pre-check is still necessary or if relying on the DB error is sufficient
                // throw new Error(`Cannot delete contract line that is currently in use by clients in tenant ${tenant}`);
            }

            // Check if contract line has associated services before attempting to delete
            const hasServices = await ContractLine.hasAssociatedServices(trx, contractLineId);
            if (hasServices) {
                throw new Error(`Cannot delete contract line that has associated services. Please remove all services from this contract line before deleting.`);
            }

            await ContractLine.delete(trx, contractLineId);
        });
    } catch (error) {
        console.error('Error deleting contract line:', error);
        if (error instanceof Error) {
            // Check for specific PostgreSQL foreign key violation error code (23503)
            // This indicates the contract line is likely referenced by another table (e.g., client_contract_lines)
            // We cast to 'any' to access potential driver-specific properties like 'code'
            if ((error as any).code === '23503') {
                 // Fetch client IDs associated with the contract line
                 const { knex: queryKnex, tenant: queryTenant } = await createTenantKnex();
                 const clientContractLineLinks = await withTransaction(queryKnex, async (trx: Knex.Transaction) => {
                     return await trx('client_contract_lines')
                         .select('client_id')
                         .where({ contract_line_id: contractLineId, tenant: queryTenant });
                 });

                 const clientIds = clientContractLineLinks.map(link => link.client_id);

                 let clientNames: string[] = [];
                 if (clientIds.length > 0) {
                     const clients = await withTransaction(queryKnex, async (trx: Knex.Transaction) => {
                         return await trx('clients')
                             .select('client_name')
                             .whereIn('client_id', clientIds)
                             .andWhere({ tenant: queryTenant });
                     });
                     clientNames = clients.map(c => c.client_name);
                 }

                 let errorMessage = "Cannot delete contract line: It is currently assigned to one or more clients.";
                 if (clientNames.length > 0) {
                     // Truncate if too many names
                     const displayLimit = 5;
                     const displayNames = clientNames.length > displayLimit
                         ? clientNames.slice(0, displayLimit).join(', ') + ` and ${clientNames.length - displayLimit} more`
                         : clientNames.join(', ');
                     errorMessage = `Cannot delete contract line: It is assigned to the following clients: ${displayNames}.`;
                 }
                 throw new Error(errorMessage);
            }

            // Preserve the user-friendly error from the hasAssociatedServices pre-check
            if (error.message.includes('associated services')) {
                throw error;
            }

            // Preserve other specific error messages (including the one from the 'isInUse' pre-check)
            throw error;
        }
        // Fallback for non-Error objects
        throw new Error(`Failed to delete contract line: ${error}`);
    }
}

/**
 * Gets the combined fixed contract line configuration (contract line-level and service-level)
 * Fetches proration/alignment from contract_line_fixed_config and base_rate from contract_line_service_fixed_config.
 */
export async function getCombinedFixedContractLineConfiguration(
    contractLineId: string,
    serviceId: string
): Promise<{
    base_rate?: number | null;
    enable_proration: boolean;
    billing_cycle_alignment: 'start' | 'end' | 'prorated';
    config_id?: string; // Service-specific config ID
} | null> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error('No authenticated user found');
        }

        const { knex, tenant } = await createTenantKnex(); // Get knex instance
        if (!tenant) {
            throw new Error("tenant context not found");
        }

        return await withTransaction(knex, async (trx: Knex.Transaction) => {
            if (!await hasPermission(currentUser, 'billing', 'read', trx)) {
                throw new Error('Permission denied: Cannot read contract line configurations');
            }

            // --- Fetch Contract Line-Level Config (Base Rate, Proration, Alignment) ---
            // Use the existing getContractLineFixedConfig action which should now return base_rate
            const contractLineConfig = await getContractLineFixedConfig(contractLineId);

            // Default values if contract line-level config doesn't exist
            const contract_line_base_rate = contractLineConfig?.base_rate ?? null; // Get base_rate from contract line config
            const enable_proration = contractLineConfig?.enable_proration ?? false;
            const billing_cycle_alignment = contractLineConfig?.billing_cycle_alignment ?? 'start';

            // --- Fetch Service-Level Config ID (Optional, if needed elsewhere) ---
            // We no longer need service-level config to get the base rate for the combined view.
            // We might still need the config_id if the caller uses it.
            const configService = new ContractLineServiceConfigurationService(trx, tenant);
            const serviceBaseConfig = await configService.getConfigurationForService(contractLineId, serviceId);
            const config_id: string | undefined = serviceBaseConfig?.config_id;

            // Base rate now comes from contractLineConfig fetched above
            const base_rate = contract_line_base_rate;

            // --- Combine Results ---
            // Return null only if BOTH contract line and service config are missing? Or just if service config is missing?
            // Current logic: returns combined data even if service config (base_rate) is missing.
            // If serviceBaseConfig is required, uncomment the check below:
            // if (!serviceBaseConfig) {
            //     return null;
            // }

            return {
                base_rate: base_rate,
                enable_proration: enable_proration,
                billing_cycle_alignment: billing_cycle_alignment,
                config_id: config_id
            };
        });

    } catch (error) {
        console.error('Error fetching combined fixed contract line configuration:', error);
        if (error instanceof Error) {
            throw error; // Preserve specific error messages
        }
        throw new Error(`Failed to fetch combined fixed contract line configuration for contract line ${contractLineId}, service ${serviceId}: ${error}`);
    }
}

/**
 * Gets only the contract line-level fixed configuration (proration, alignment)
 */
export async function getContractLineFixedConfig(contractLineId: string): Promise<IContractLineFixedConfig | null> {
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
            if (!await hasPermission(currentUser, 'billing', 'read', trx)) {
                throw new Error('Permission denied: Cannot read contract line configurations');
            }

            const model = new ContractLineFixedConfig(trx, tenant);
            const config = await model.getByContractLineId(contractLineId);
            return config;
        });
    } catch (error) {
        console.error(`Error fetching contract_line_fixed_config for contract line ${contractLineId}:`, error);
        if (error instanceof Error) {
            throw error;
        }
        throw new Error(`Failed to fetch contract_line_fixed_config for contract line ${contractLineId}: ${error}`);
    }
}

/**
 * Updates the contract line-level fixed configuration (proration, alignment) in contract_line_fixed_config.
 * Uses upsert logic: creates if not exists, updates if exists.
 */
export async function updateContractLineFixedConfig(
    contractLineId: string,
    configData: Partial<Omit<IContractLineFixedConfig, 'contract_line_id' | 'tenant' | 'created_at' | 'updated_at'>>
): Promise<boolean> {
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
                throw new Error('Permission denied: Cannot update contract line configurations');
            }

            // Fetch the existing contract line to check its type
            const existingContractLine = await ContractLine.findById(trx, contractLineId); // Use ContractLine model directly
            if (!existingContractLine) {
                throw new Error(`Contract Line with ID ${contractLineId} not found.`);
            }
            if (existingContractLine.contract_line_type !== 'Fixed') {
                throw new Error(`Cannot update fixed contract line configuration for non-fixed contract line type: ${existingContractLine.contract_line_type}`);
            }

            const model = new ContractLineFixedConfig(trx, tenant);
            
            // Prepare data for upsert, ensuring contract_line_id and tenant are included
            // Prepare data for upsert, ensuring contract_line_id, tenant, and base_rate are included
            const upsertData: Omit<IContractLineFixedConfig, 'created_at' | 'updated_at'> & { base_rate?: number | null } = {
                contract_line_id: contractLineId,
                base_rate: configData.base_rate, // Include base_rate from input
                enable_proration: configData.enable_proration ?? false, // Provide default if undefined
                billing_cycle_alignment: configData.billing_cycle_alignment ?? 'start', // Provide default if undefined
                tenant: tenant,
            };

            return await model.upsert(upsertData);
        });

    } catch (error) {
        console.error(`Error upserting contract_line_fixed_config for contract line ${contractLineId}:`, error);
        if (error instanceof Error) {
            throw error;
        }
        throw new Error(`Failed to upsert contract_line_fixed_config for contract line ${contractLineId}: ${error}`);
    }
}


/**
 * Updates only the base_rate for a specific service within a fixed contract line.
 * Interacts with contract_line_service_fixed_config.
 * Renamed from updateFixedContractLineConfiguration.
 */
export async function updateContractLineServiceFixedConfigRate(
    contractLineId: string,
    serviceId: string,
    baseRate: number | null // Only accept base_rate
): Promise<boolean> {
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
                throw new Error('Permission denied: Cannot update contract line configurations');
            }

            // Fetch the existing contract line to check its type
            const existingContractLine = await ContractLine.findById(trx, contractLineId); // Use ContractLine model directly
            if (!existingContractLine) {
                throw new Error(`Contract Line with ID ${contractLineId} not found.`);
            }
            if (existingContractLine.contract_line_type !== 'Fixed') {
                throw new Error(`Cannot update fixed service config rate for non-fixed contract line type: ${existingContractLine.contract_line_type}`);
            }

            // Create configuration service
            const configService = new ContractLineServiceConfigurationService(trx, tenant);
            
            // Get existing configuration for this contract line and service
            let config = await configService.getConfigurationForService(contractLineId, serviceId);

            if (!config) {
                // If no configuration exists, create a new one with the provided base_rate
                console.log(`Creating new fixed contract line service configuration for contract line ${contractLineId}, service ${serviceId}`);
                
                const configId = await configService.createConfiguration(
                    { // Base config data
                        contract_line_id: contractLineId,
                        service_id: serviceId,
                        configuration_type: 'Fixed',
                        tenant
                    },
                    { // Type config data (only base_rate now)
                        base_rate: baseRate
                    }
                    // No proration/alignment data passed here anymore
                );
                
                return !!configId;
            } else {
                // Update existing configuration's base_rate
                console.log(`Updating fixed contract line service configuration base_rate for contract line ${contractLineId}, service ${serviceId}`);
                
                // Prepare fixed config update data (only base_rate)
                const fixedConfigData: Partial<IContractLineServiceFixedConfig> = {
                     base_rate: baseRate
                };
                
                // Update the configuration using the service
                return await configService.updateConfiguration(
                    config.config_id,
                    undefined, // No base config updates needed
                    fixedConfigData // Only contains base_rate
                );
            }
        });
    } catch (error) {
        console.error('Error updating fixed contract line service config rate:', error);
        if (error instanceof Error) {
            throw error; // Preserve specific error messages
        }
        throw new Error(`Failed to update fixed contract line service config rate for contract line ${contractLineId}, service ${serviceId}: ${error}`);
    }
}
