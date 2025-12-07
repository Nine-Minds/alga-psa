// server/src/lib/actions/contractLineActions.ts
'use server'
import ContractLine from 'server/src/lib/models/contractLine';
import { IContractLine, IContractLineFixedConfig } from 'server/src/interfaces/billing.interfaces'; // Added IContractLineFixedConfig
import { createTenantKnex } from 'server/src/lib/db';
import { Knex } from 'knex'; // Import Knex type
import { ContractLineServiceConfigurationService } from 'server/src/lib/services/contractLineServiceConfigurationService';
import { IContractLineServiceFixedConfig } from 'server/src/interfaces/contractLineServiceConfiguration.interfaces';
import ContractLineFixedConfig from 'server/src/lib/models/contractLineFixedConfig'; // Added import for new model
import { withTransaction } from '@alga-psa/shared/db';
import { getCurrentUser } from './user-actions/userActions';
import { hasPermission } from 'server/src/lib/auth/rbac';
import { analytics } from '../analytics/posthog';
import { AnalyticsEvents } from '../analytics/events';

export async function getContractLines(): Promise<IContractLine[]> {
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
                throw new Error('Permission denied: Cannot read contract lines');
            }

            const plans = await ContractLine.getAll(trx);
            // billing_timing is stored directly on contract_lines (added in migration 20251025120000)
            // No need to query a separate terms table
            const enrichedPlans = plans.map((plan) => ({
                ...plan,
                billing_timing: (plan.billing_timing ?? 'arrears') as 'arrears' | 'advance',
            }));

            return enrichedPlans;
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
export async function getContractLineById(planId: string): Promise<IContractLine | null> {
    let tenant_copy: string = '';
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
        tenant_copy = tenant;

        return await withTransaction(knex, async (trx: Knex.Transaction) => {
            if (!isBypass && !await hasPermission(currentUser, 'billing', 'read', trx)) {
                throw new Error('Permission denied: Cannot read contract lines');
            }

            const templateLine = await trx('contract_template_lines')
                .where({ tenant, template_line_id: planId })
                .first();

            if (templateLine) {
                const templateTerms = await trx('contract_template_line_terms')
                    .where({ tenant, template_line_id: planId })
                    .first();

                return {
                    contract_line_id: templateLine.template_line_id,
                    contract_line_name: templateLine.template_line_name,
                    billing_frequency: templateLine.billing_frequency,
                    is_custom: true,
                    contract_id: templateLine.template_id,
                    tenant,
                    display_order: templateLine.display_order ?? 0,
                    custom_rate: templateLine.custom_rate != null ? Number(templateLine.custom_rate) : null,
                    billing_timing: (templateLine.billing_timing ?? templateTerms?.billing_timing ?? 'arrears') as 'arrears' | 'advance',
                    contract_line_type: templateLine.line_type ?? 'Fixed',
                    service_category: templateLine.service_category ?? null,
                    is_active: templateLine.is_active ?? true,
                    created_at: templateLine.created_at,
                    updated_at: templateLine.updated_at,
                } as IContractLine;
            }

            // Assuming the ContractLine model has a method like findById
            // This might need adjustment based on the actual model implementation
            // It should ideally fetch the base plan and potentially join/fetch config details
            const plan = await ContractLine.findById(trx, planId);
            if (!plan) {
                return null;
            }

            // billing_timing is stored directly on contract_lines
            return {
                ...plan,
                billing_timing: (plan.billing_timing ?? 'arrears') as 'arrears' | 'advance',
            };
        });
    } catch (error) {
        console.error(`Error fetching contract line with ID ${planId}:`, error);
        if (error instanceof Error) {
            // Handle specific errors like 'not found' if the model throws them
            if (error.message.includes('not found')) { // Example check
                return null;
            }
            throw error;
        }
        throw new Error(`Failed to fetch contract line ${planId} in tenant ${tenant_copy}: ${error}`);
    }
}

export async function createContractLine(
    planData: Omit<IContractLine, 'contract_line_id'>
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

            // Remove tenant field if present in planData to prevent override
            const { tenant: _, ...safePlanData } = planData;
            delete safePlanData.billing_timing;
            const plan = await ContractLine.create(trx, safePlanData);
            const enrichedPlan: IContractLine = {
                ...plan,
                billing_timing: (plan.billing_timing ?? 'arrears') as 'arrears' | 'advance',
            };

            // Track analytics
            analytics.capture(AnalyticsEvents.BILLING_RULE_CREATED, {
                contract_line_id: enrichedPlan.contract_line_id,
                contract_line_name: enrichedPlan.contract_line_name,
                contract_line_type: enrichedPlan.contract_line_type
            }, currentUser.user_id);

            return enrichedPlan;
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
    planId: string,
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

            // Fetch the existing plan to check its type
            const existingPlan = await ContractLine.findById(trx, planId);
            if (!existingPlan) {
                // Handle case where plan is not found before update attempt
                throw new Error(`Contract Line with ID ${planId} not found.`);
            }

            // Remove tenant field if present in updateData to prevent override
            const { tenant: _, ...safeUpdateData } = updateData;

            // If the plan is hourly, remove only the per-service hourly_rate field
            // minimum_billable_time and round_up_to_nearest are now contract-line-level
            if (existingPlan.contract_line_type === 'Hourly') {
                delete safeUpdateData.hourly_rate;
            }
            delete safeUpdateData.billing_timing;

            // Proceed with the update using the potentially modified data
            // Ensure ContractLine.update handles empty updateData gracefully if all fields were removed
            const plan = await ContractLine.update(trx, planId, safeUpdateData);

            // billing_timing is stored directly on contract_lines
            const enrichedPlan: IContractLine = {
                ...plan,
                billing_timing: (plan.billing_timing ?? 'arrears') as 'arrears' | 'advance',
            };

            // Track analytics
            analytics.capture(AnalyticsEvents.BILLING_RULE_UPDATED, {
                contract_line_id: enrichedPlan.contract_line_id,
                contract_line_name: enrichedPlan.contract_line_name,
                contract_line_type: enrichedPlan.contract_line_type,
                updated_fields: Object.keys(safeUpdateData)
            }, currentUser.user_id);

            return enrichedPlan;
        });
    } catch (error) {
        console.error('Error updating contract line:', error);
        if (error instanceof Error) {
            // Re-throw specific errors like 'not found' if they weren't caught above
            if (error.message.includes('not found')) {
                 throw new Error(`Contract Line with ID ${planId} not found during update.`);
            }
            throw error; // Preserve other specific error messages
        }
        throw new Error(`Failed to update contract line ${planId}: ${error}`);
    }
}

export async function upsertContractLineTerms(
    contractLineId: string,
    billingTiming: 'arrears' | 'advance'
): Promise<void> {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
        throw new Error('No authenticated user found');
    }

    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
        throw new Error("tenant context not found");
    }

    await withTransaction(knex, async (trx: Knex.Transaction) => {
        if (!await hasPermission(currentUser, 'billing', 'update', trx)) {
            throw new Error('Permission denied: Cannot update contract line terms');
        }

        const contractLine = await ContractLine.findById(trx, contractLineId);
        if (!contractLine) {
            throw new Error(`Contract line ${contractLineId} not found.`);
        }

        if (billingTiming === 'advance' && contractLine.contract_line_type !== 'Fixed') {
            throw new Error('Advance billing is only supported for fixed contract lines.');
        }

        // Update billing_timing directly on contract_lines table
        // (migration 20251025120000 added this column)
        await trx('contract_lines')
            .where({ tenant, contract_line_id: contractLineId })
            .update({
                billing_timing: billingTiming,
                updated_at: trx.fn.now(),
            });

        // Also update contract_template_line_terms if this is a template line
        await trx('contract_template_line_terms')
            .where({ tenant, template_line_id: contractLineId })
            .update({
                billing_timing: billingTiming,
                updated_at: trx.fn.now(),
            });
    });
}

export async function deleteContractLine(planId: string): Promise<void> {
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

            // Check if plan is associated with any contracts and fetch associated clients
            // After migration 20251028090000, data is stored directly in contract_lines
            const contractsWithClients = await trx('contract_lines as cl')
                .join('contracts as c', function() {
                    this.on('cl.contract_id', '=', 'c.contract_id')
                        .andOn('cl.tenant', '=', 'c.tenant');
                })
                .leftJoin('client_contracts as cc', function() {
                    this.on('c.contract_id', '=', 'cc.contract_id')
                        .andOn('cc.is_active', '=', trx.raw('?', [true]));
                })
                .leftJoin('clients as cli', function() {
                    this.on('cc.client_id', '=', 'cli.client_id')
                        .andOn('cli.tenant', '=', trx.raw('?', [tenant]));
                })
                .where('cl.contract_line_id', planId)
                .where('cl.tenant', tenant)
                .whereNotNull('cl.contract_id')
                .select('c.contract_name', 'cli.client_name', 'c.contract_id')
                .orderBy(['c.contract_name', 'cli.client_name']);

            if (contractsWithClients.length > 0) {
                // Group clients by contract
                const contractMap = new Map<string, { contractName: string; clients: string[] }>();

                for (const row of contractsWithClients) {
                    if (!contractMap.has(row.contract_id)) {
                        contractMap.set(row.contract_id, {
                            contractName: row.contract_name,
                            clients: []
                        });
                    }
                    if (row.client_name) {
                        contractMap.get(row.contract_id)!.clients.push(row.client_name);
                    }
                }

                // Build detailed error message with contract and client info
                const details = Array.from(contractMap.values()).map(({ contractName, clients }) => {
                    if (clients.length > 0) {
                        return `${contractName} (assigned to: ${clients.join(', ')})`;
                    }
                    return contractName;
                });

                // Create a structured error message that the UI can parse
                const errorData = JSON.stringify({
                    type: 'CONTRACT_LINE_IN_USE',
                    contracts: Array.from(contractMap.values()).map(({ contractName, clients }) => ({
                        name: contractName,
                        clients: clients
                    }))
                });

                throw new Error(`STRUCTURED_ERROR:${errorData}`);
            }

            await ContractLine.delete(trx, planId);
        });
    } catch (error) {
        console.error('Error deleting contract line:', error);
        if (error instanceof Error) {
            // Check for specific PostgreSQL foreign key violation error code (23503)
            // This indicates the plan is likely referenced by another table (e.g., client_contract_lines)
            // We cast to 'any' to access potential driver-specific properties like 'code'
            if ((error as any).code === '23503') {
                 // Fetch client IDs associated with the plan
                 const { knex: queryKnex, tenant: queryTenant } = await createTenantKnex();
                 const clientPlanLinks = await withTransaction(queryKnex, async (trx: Knex.Transaction) => {
                     return await trx('client_contract_lines')
                         .select('client_id')
                         .where({ contract_line_id: planId, tenant: queryTenant });
                 });

                 const clientIds = clientPlanLinks.map(link => link.client_id);

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
 * Gets the combined fixed plan configuration (plan-level and service-level)
 * Fetches proration/alignment from contract_line_fixed_config and base_rate from contract_line_service_fixed_config.
 */
export async function getCombinedFixedPlanConfiguration(
    planId: string,
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

            // --- Fetch Plan-Level Config (Base Rate, Proration, Alignment) ---
            // Use the existing getContractLineFixedConfig action which should now return base_rate
            const planConfig = await getContractLineFixedConfig(planId);

            // Default values if plan-level config doesn't exist
            const contract_line_base_rate = planConfig?.base_rate ?? null; // Get base_rate from plan config
            const enable_proration = planConfig?.enable_proration ?? false;
            const billing_cycle_alignment = planConfig?.billing_cycle_alignment ?? 'start';

            // --- Fetch Service-Level Config ID (Optional, if needed elsewhere) ---
            // We no longer need service-level config to get the base rate for the combined view.
            // We might still need the config_id if the caller uses it.
            const configService = new ContractLineServiceConfigurationService(trx, tenant);
            const serviceBaseConfig = await configService.getConfigurationForService(planId, serviceId);
            const config_id: string | undefined = serviceBaseConfig?.config_id;

            // Base rate now comes from planConfig fetched above
            const base_rate = contract_line_base_rate;

            // --- Combine Results ---
            // Return null only if BOTH plan and service config are missing? Or just if service config is missing?
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
        console.error('Error fetching combined fixed plan configuration:', error);
        if (error instanceof Error) {
            throw error; // Preserve specific error messages
        }
        throw new Error(`Failed to fetch combined fixed plan configuration for plan ${planId}, service ${serviceId}: ${error}`);
    }
}

/**
 * Gets only the plan-level fixed configuration (proration, alignment)
 */
export async function getContractLineFixedConfig(planId: string): Promise<IContractLineFixedConfig | null> {
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
                throw new Error('Permission denied: Cannot read contract line configurations');
            }

            const model = new ContractLineFixedConfig(trx, tenant);
            const config = await model.getByPlanId(planId);
            return config;
        });
    } catch (error) {
        console.error(`Error fetching contract_line_fixed_config for plan ${planId}:`, error);
        if (error instanceof Error) {
            throw error;
        }
        throw new Error(`Failed to fetch contract_line_fixed_config for plan ${planId}: ${error}`);
    }
}

/**
 * Updates the plan-level fixed configuration (proration, alignment) in contract_line_fixed_config.
 * Uses upsert logic: creates if not exists, updates if exists.
 */
export async function updateContractLineFixedConfig(
    planId: string,
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

            // Fetch the existing plan to check its type
            const existingPlan = await ContractLine.findById(trx, planId); // Use ContractLine model directly
            if (!existingPlan) {
                throw new Error(`Contract Line with ID ${planId} not found.`);
            }
            if (existingPlan.contract_line_type !== 'Fixed') {
                throw new Error(`Cannot update fixed plan configuration for non-fixed plan type: ${existingPlan.contract_line_type}`);
            }

            const model = new ContractLineFixedConfig(trx, tenant);
            
            // Prepare data for upsert, ensuring contract_line_id and tenant are included
            // Prepare data for upsert, ensuring contract_line_id, tenant, and base_rate are included
            const upsertData: Omit<IContractLineFixedConfig, 'created_at' | 'updated_at'> & { base_rate?: number | null } = {
                contract_line_id: planId,
                base_rate: configData.base_rate, // Include base_rate from input
                enable_proration: configData.enable_proration ?? false, // Provide default if undefined
                billing_cycle_alignment: configData.billing_cycle_alignment ?? 'start', // Provide default if undefined
                tenant: tenant,
            };

            return await model.upsert(upsertData);
        });

    } catch (error) {
        console.error(`Error upserting contract_line_fixed_config for plan ${planId}:`, error);
        if (error instanceof Error) {
            throw error;
        }
        throw new Error(`Failed to upsert contract_line_fixed_config for plan ${planId}: ${error}`);
    }
}


/**
 * Updates only the base_rate for a specific service within a fixed plan.
 * Interacts with contract_line_service_fixed_config.
 * Renamed from updateFixedPlanConfiguration.
 */
export async function updatePlanServiceFixedConfigRate(
    planId: string,
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

            // Fetch the existing plan to check its type
            const existingPlan = await ContractLine.findById(trx, planId); // Use ContractLine model directly
            if (!existingPlan) {
                throw new Error(`Contract Line with ID ${planId} not found.`);
            }
            if (existingPlan.contract_line_type !== 'Fixed') {
                throw new Error(`Cannot update fixed service config rate for non-fixed plan type: ${existingPlan.contract_line_type}`);
            }

            // Create configuration service
            const configService = new ContractLineServiceConfigurationService(trx, tenant);
            
            // Get existing configuration for this plan and service
            let config = await configService.getConfigurationForService(planId, serviceId);
            
            if (!config) {
                // If no configuration exists, create a new one with the provided base_rate
                console.log(`Creating new fixed plan service configuration for plan ${planId}, service ${serviceId}`);
                
                const configId = await configService.createConfiguration(
                    { // Base config data
                        contract_line_id: planId,
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
                console.log(`Updating fixed plan service configuration base_rate for plan ${planId}, service ${serviceId}`);
                
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
        console.error('Error updating fixed plan service config rate:', error);
        if (error instanceof Error) {
            throw error; // Preserve specific error messages
        }
        throw new Error(`Failed to update fixed plan service config rate for plan ${planId}, service ${serviceId}: ${error}`);
    }
}
