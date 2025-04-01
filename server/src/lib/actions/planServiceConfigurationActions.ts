'use server';

import { z } from 'zod'; // Add Zod import
import { createTenantKnex } from 'server/src/lib/db';
import {
  IPlanServiceConfiguration,
  IPlanServiceFixedConfig,
  IPlanServiceHourlyConfig,
  IPlanServiceUsageConfig,
  IPlanServiceBucketConfig,
  IPlanServiceRateTier, // Import the rate tier interface
  IUserTypeRate, // Added comma
  IPlanServiceRateTierInput
} from 'server/src/interfaces/planServiceConfiguration.interfaces';
import { PlanServiceConfigurationService } from 'server/src/lib/services/planServiceConfigurationService';

/**
 * Get a plan service configuration with its type-specific configuration
 */
export async function getConfigurationWithDetails(configId: string): Promise<{
  baseConfig: IPlanServiceConfiguration;
  typeConfig: IPlanServiceFixedConfig | IPlanServiceHourlyConfig | IPlanServiceUsageConfig | IPlanServiceBucketConfig | null;
  rateTiers?: IPlanServiceRateTier[];
  userTypeRates?: IUserTypeRate[];
}> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error("tenant context not found");
  }
  const configService = new PlanServiceConfigurationService(knex, tenant);
  
  return await configService.getConfigurationWithDetails(configId);
}

/**
 * Get all configurations for a plan
 */
export async function getConfigurationsForPlan(planId: string): Promise<IPlanServiceConfiguration[]> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error("tenant context not found");
  }
  const configService = new PlanServiceConfigurationService(knex, tenant);
  
  return await configService.getConfigurationsForPlan(planId);
}

/**
 * Get configuration for a specific service within a plan
 */
export async function getConfigurationForService(planId: string, serviceId: string): Promise<IPlanServiceConfiguration | null> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error("tenant context not found");
  }
  const configService = new PlanServiceConfigurationService(knex, tenant);
  
  return await configService.getConfigurationForService(planId, serviceId);
}

/**
 * Create a new plan service configuration with its type-specific configuration
 */
export async function createConfiguration(
  baseConfig: Omit<IPlanServiceConfiguration, 'config_id' | 'created_at' | 'updated_at'>,
  typeConfig: Partial<IPlanServiceFixedConfig | IPlanServiceHourlyConfig | IPlanServiceUsageConfig | IPlanServiceBucketConfig>,
  rateTiers?: Omit<IPlanServiceRateTier, 'tier_id' | 'config_id' | 'created_at' | 'updated_at'>[],
  userTypeRates?: Omit<IUserTypeRate, 'rate_id' | 'config_id' | 'created_at' | 'updated_at'>[]
): Promise<string> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error("tenant context not found");
  }
  const configService = new PlanServiceConfigurationService(knex, tenant);
  
  // Ensure tenant is set
  baseConfig.tenant = tenant;
  
  return await configService.createConfiguration(baseConfig, typeConfig, rateTiers, userTypeRates);
}

/**
 * Update a plan service configuration with its type-specific configuration
 */
export async function updateConfiguration(
  configId: string,
  baseConfig?: Partial<IPlanServiceConfiguration>,
  typeConfig?: Partial<IPlanServiceFixedConfig | IPlanServiceHourlyConfig | IPlanServiceUsageConfig | IPlanServiceBucketConfig>,
  rateTiers?: IPlanServiceRateTier[] // Add rateTiers parameter
): Promise<boolean> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error("tenant context not found");
  }
  const configService = new PlanServiceConfigurationService(knex, tenant);
  
  return await configService.updateConfiguration(configId, baseConfig, typeConfig, rateTiers); // Pass rateTiers
}

/**
 * Delete a plan service configuration and its type-specific configuration
 */
export async function deleteConfiguration(configId: string): Promise<boolean> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error("tenant context not found");
  }
  const configService = new PlanServiceConfigurationService(knex, tenant);
  
  return await configService.deleteConfiguration(configId);
}

/**
 * Add a rate tier to a usage configuration
 */
export async function addRateTier(
  configId: string,
  tierData: Omit<IPlanServiceRateTier, 'tier_id' | 'config_id' | 'created_at' | 'updated_at' | 'tenant'>
): Promise<string> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error("tenant context not found");
  }
  const usageConfigModel = new (await import('server/src/lib/models/planServiceUsageConfig')).default(knex, tenant);
  
  return await usageConfigModel.addRateTier({
    ...tierData,
    config_id: configId,
    tenant
  });
}

/**
 * Update a rate tier
 */
export async function updateRateTier(
  tierId: string,
  tierData: Partial<Omit<IPlanServiceRateTier, 'tier_id' | 'tenant'>>
): Promise<boolean> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error("tenant context not found");
  }
  const usageConfigModel = new (await import('server/src/lib/models/planServiceUsageConfig')).default(knex, tenant);
  
  return await usageConfigModel.updateRateTier(tierId, tierData);
}

/**
 * Delete a rate tier
 */
export async function deleteRateTier(tierId: string): Promise<boolean> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error("tenant context not found");
  }
  const usageConfigModel = new (await import('server/src/lib/models/planServiceUsageConfig')).default(knex, tenant);
  
  return await usageConfigModel.deleteRateTier(tierId);
}

/**
 * Add a user type rate to an hourly configuration
 */
export async function addUserTypeRate(
  configId: string,
  rateData: Omit<IUserTypeRate, 'rate_id' | 'config_id' | 'created_at' | 'updated_at' | 'tenant'>
): Promise<string> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error("tenant context not found");
  }
  const hourlyConfigModel = new (await import('server/src/lib/models/planServiceHourlyConfig')).default(knex, tenant);
  
  return await hourlyConfigModel.addUserTypeRate({
    ...rateData,
    config_id: configId,
    tenant
  });
}

/**
 * Update a user type rate
 */
export async function updateUserTypeRate(
  rateId: string,
  rateData: Partial<Omit<IUserTypeRate, 'rate_id' | 'tenant'>>
): Promise<boolean> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error("tenant context not found");
  }
  const hourlyConfigModel = new (await import('server/src/lib/models/planServiceHourlyConfig')).default(knex, tenant);
  
  return await hourlyConfigModel.updateUserTypeRate(rateId, rateData);
}

/**
 * Delete a user type rate
 */
export async function deleteUserTypeRate(rateId: string): Promise<boolean> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error("tenant context not found");
  }
  const hourlyConfigModel = new (await import('server/src/lib/models/planServiceHourlyConfig')).default(knex, tenant);
  
  return await hourlyConfigModel.deleteUserTypeRate(rateId);
}

// --- Zod Schema for User Type Rate Input ---
const UserTypeRateInputSchema = z.object({
  user_type: z.string().min(1, "User type cannot be empty"),
  rate: z.number().min(0, "Rate cannot be negative"),
});

const UpsertUserTypeRatesInputSchema = z.object({
  configId: z.string().uuid("Invalid Configuration ID"),
  rates: z.array(UserTypeRateInputSchema),
});

/**
 * Upserts (replaces) all user type rates for a specific hourly configuration.
 * Deletes existing rates and inserts the provided ones within a transaction.
 */
export async function upsertUserTypeRatesForConfig(
  input: z.infer<typeof UpsertUserTypeRatesInputSchema>
): Promise<void> {
  // Validate input
  const validationResult = UpsertUserTypeRatesInputSchema.safeParse(input);
  if (!validationResult.success) {
    // Combine Zod error messages for clarity
    const errorMessages = validationResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
    throw new Error(`Validation Error: ${errorMessages}`);
  }

  const { configId, rates } = validationResult.data;
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error("tenant context not found");
  }

  // Use the service, assuming it has a method for this bulk operation
  // If not, we'd implement the transaction logic here or add the method to the service.
  const configService = new PlanServiceConfigurationService(knex, tenant);

  try {
    // Assuming a method like this exists or will be added to the service:
    await configService.upsertUserTypeRates(configId, rates);
  } catch (error) {
    console.error(`Error upserting user type rates for config ${configId}:`, error);
    if (error instanceof Error) {
      throw error; // Re-throw specific errors
    }
    throw new Error(`Failed to update user type rates for config ${configId}.`);
  }
}

// --- New Actions for Tiered Service Pricing ---

/**
 * Interface combining base service config, usage config, and tiers.
 */
export interface IFullPlanServiceUsageConfiguration extends IPlanServiceConfiguration, Omit<IPlanServiceUsageConfig, 'config_id' | 'created_at' | 'updated_at' | 'tenant'> {
  tiers?: IPlanServiceRateTier[];
}

/**
 * Fetches the full service-level configuration (base, usage details, and tiers) for a specific service within a plan.
 * Corresponds to Phase 1 Task: Backend fetch action (`getPlanServiceConfiguration`)
 */
export async function getPlanServiceConfiguration(planId: string, serviceId: string): Promise<IFullPlanServiceUsageConfiguration | null> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error("tenant context not found");
  }
  const configService = new PlanServiceConfigurationService(knex, tenant);

  // TODO: Implement logic using configService or direct queries
  // 1. Get base config using configService.getConfigurationForService(planId, serviceId)
  // 2. If base config exists and is 'Usage' type:
  //    a. Get usage config using config_id
  //    b. If enable_tiered_pricing, get tiers using config_id
  // 3. Combine and return, ensuring tenant filtering

  console.log(`Fetching config for planId: ${planId}, serviceId: ${serviceId}, tenant: ${tenant}`); // Placeholder
  // Placeholder implementation - replace with actual logic
  const baseConfig = await configService.getConfigurationForService(planId, serviceId);
  if (!baseConfig || baseConfig.configuration_type !== 'Usage') {
    return null;
  }

  try {
    const usageConfig = await knex<IPlanServiceUsageConfig>('plan_service_usage_config')
      .where({ config_id: baseConfig.config_id, tenant: tenant })
      .first();

    if (!usageConfig) {
      // This case might indicate data inconsistency if baseConfig type is 'Usage'
      console.error(`Usage config not found for config_id: ${baseConfig.config_id}, tenant: ${tenant}`);
      return null; // Return null as the full configuration couldn't be retrieved
    }

    let tiers: IPlanServiceRateTier[] = [];
    if (usageConfig.enable_tiered_pricing) {
      tiers = await knex<IPlanServiceRateTier>('plan_service_rate_tiers')
        .where({ config_id: baseConfig.config_id, tenant: tenant })
        .orderBy('min_quantity', 'asc');
    }

    // Combine results
    const fullConfig: IFullPlanServiceUsageConfiguration = {
      ...baseConfig,
      unit_of_measure: usageConfig.unit_of_measure,
      minimum_usage: usageConfig.minimum_usage,
      enable_tiered_pricing: usageConfig.enable_tiered_pricing,
      base_rate: usageConfig.base_rate, // Include the new base_rate
      tiers: tiers,
    };
    return fullConfig;

  } catch (error) {
    console.error("Error fetching plan service configuration details:", error);
    throw new Error("Failed to fetch plan service configuration details.");
  }
}


/**
 * Input type for upserting plan service usage configuration.
 */
export interface IUpsertPlanServiceUsageConfigurationInput {
  planId: string;
  serviceId: string;
  // Fields from IPlanServiceUsageConfig (including base_rate)
  unit_of_measure?: string | null;
  minimum_usage?: number | null;
  enable_tiered_pricing?: boolean;
  base_rate?: number | null; // Added base_rate
  // Tiers array (using input type)
  tiers?: IPlanServiceRateTierInput[];
}

/**
 * Validates the input for upserting plan service usage configuration.
 * Throws an error if validation fails.
 */
function validatePlanServiceUsageConfigurationInput(input: IUpsertPlanServiceUsageConfigurationInput): void {
  const { base_rate, minimum_usage, enable_tiered_pricing, tiers } = input;

  if (base_rate !== undefined && base_rate !== null && base_rate < 0) {
    throw new Error("Base rate cannot be negative.");
  }

  if (minimum_usage !== undefined && minimum_usage !== null && minimum_usage < 0) {
    throw new Error("Minimum usage cannot be negative.");
  }

  if (enable_tiered_pricing) {
    if (!tiers || tiers.length === 0) {
      throw new Error("Tiered pricing is enabled, but no tiers were provided.");
    }

    // Sort tiers by min_quantity to ensure correct order for validation
    const sortedTiers = [...tiers].sort((a, b) => a.min_quantity - b.min_quantity);

    if (sortedTiers[0].min_quantity !== 0) {
      throw new Error("The first tier must start at quantity 0.");
    }

    for (let i = 0; i < sortedTiers.length; i++) {
      const tier = sortedTiers[i];

      if (tier.min_quantity < 0) {
        throw new Error(`Tier ${i + 1} (starting at ${tier.min_quantity}) minimum quantity cannot be negative.`);
      }
      if (tier.rate < 0) {
        throw new Error(`Tier ${i + 1} (starting at ${tier.min_quantity}) rate cannot be negative.`);
      }

      // Check max_quantity validity
      if (tier.max_quantity !== undefined && tier.max_quantity !== null) {
        if (tier.max_quantity < tier.min_quantity) {
          throw new Error(`Tier ${i + 1} maximum quantity (${tier.max_quantity}) cannot be less than minimum quantity (${tier.min_quantity}).`);
        }
        // Check contiguity with the next tier
        if (i < sortedTiers.length - 1) {
          const nextTier = sortedTiers[i+1];
          // Allow for floating point inaccuracies slightly if needed, but strict equality is better for integers
          if (tier.max_quantity + 1 !== nextTier.min_quantity) {
             throw new Error(`Tiers are not contiguous. Gap or overlap found between tier ending at ${tier.max_quantity} and tier starting at ${nextTier.min_quantity}.`);
          }
        }
      } else {
        // max_quantity is null or undefined, should be the last tier
        if (i < sortedTiers.length - 1) {
          throw new Error(`Tier ${i + 1} (starting at ${tier.min_quantity}) has no maximum quantity but is not the last tier.`);
        }
      }
    }
  }
}


/**
 * Upserts the service-level configuration (base, usage details, base rate, and tiers) for a specific service within a plan.
 * Handles creation or update within a transaction and includes validation.
 * Corresponds to Phase 1 Tasks:
 * - Backend upsert action (`upsertPlanServiceConfiguration`)
 * - Backend validation within upsert
 * - Backend data type handling and tenant filtering
 */
export async function upsertPlanServiceConfiguration(input: IUpsertPlanServiceUsageConfigurationInput): Promise<IFullPlanServiceUsageConfiguration> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error("tenant context not found");
  }
  const configService = new PlanServiceConfigurationService(knex, tenant); // May not be fully used if direct transaction is needed

  // --- Validation (Phase 1 Task) ---
  try {
    validatePlanServiceUsageConfigurationInput(input);
  } catch (validationError: any) {
    console.error("Validation failed for upsertPlanServiceConfiguration:", validationError.message);
    // Re-throw or handle as a specific validation error response
    throw new Error(`Validation Error: ${validationError.message}`);
  }
  // --- End Validation ---

  const { planId, serviceId, tiers, ...usageConfigInput } = input;

  try {
    const updatedConfig = await knex.transaction(async (trx) => {
      const trxConfigService = new PlanServiceConfigurationService(trx, tenant); // Use transaction knex

      // 1. Upsert plan_service_configuration
      let baseConfig = await trxConfigService.getConfigurationForService(planId, serviceId);
      let configId: string;

      if (baseConfig) {
        // Update if exists (though only type is relevant here, maybe updated_at)
        configId = baseConfig.config_id;
        await trx('plan_service_configuration')
          .where({ config_id: configId, tenant: tenant })
          // Ensure type is 'Usage' on update as well
          .update({ configuration_type: 'Usage', updated_at: new Date() });
      } else {
        // Create if not exists
        const newBaseConfig: Omit<IPlanServiceConfiguration, 'config_id' | 'created_at' | 'updated_at'> = {
          plan_id: planId,
          service_id: serviceId,
          configuration_type: 'Usage', // Explicitly set type
          tenant: tenant,
          custom_rate: undefined, // Use undefined instead of null
        };
        const insertedIds = await trx('plan_service_configuration')
          .insert(newBaseConfig)
          .returning('config_id');
        configId = insertedIds[0].config_id;
      }

      // 2. Upsert plan_service_usage_config
      const usageConfigPayload = {
        ...usageConfigInput,
        config_id: configId,
        tenant: tenant,
        // Ensure numeric types are handled correctly
        base_rate: usageConfigInput.base_rate !== undefined && usageConfigInput.base_rate !== null ? Number(usageConfigInput.base_rate) : null,
        minimum_usage: usageConfigInput.minimum_usage !== undefined && usageConfigInput.minimum_usage !== null ? Number(usageConfigInput.minimum_usage) : null,
      };

      // Use explicit insert/update with conflict handling for upsert
      await trx('plan_service_usage_config')
        .insert(usageConfigPayload)
        .onConflict(['config_id', 'tenant']) // Assumes this unique constraint exists
        .merge() // Update existing row on conflict
        .returning('*'); // Get the updated/inserted row if needed


      // 3. Handle Tiers
      // Always delete existing tiers first for simplicity in upsert
      await trx('plan_service_rate_tiers')
        .where({ config_id: configId, tenant: tenant })
        .del();

      if (usageConfigInput.enable_tiered_pricing && tiers && tiers.length > 0) {
        // Insert new tiers if enabled and provided
        const tiersToInsert = tiers.map(tier => ({
          ...tier,
          config_id: configId,
          tenant: tenant,
          // Ensure numeric/integer types
          min_quantity: Number(tier.min_quantity),
          max_quantity: tier.max_quantity !== undefined && tier.max_quantity !== null ? Number(tier.max_quantity) : null,
          rate: Number(tier.rate),
        }));
        await trx('plan_service_rate_tiers').insert(tiersToInsert);
      }

      // Fetch the final combined configuration to return
      // Re-use the logic from getPlanServiceConfiguration but with the transaction trx
      const finalBaseConfig = await trx<IPlanServiceConfiguration>('plan_service_configuration')
        .where({ config_id: configId, tenant: tenant })
        .first();

      if (!finalBaseConfig) throw new Error("Failed to retrieve base config after upsert"); // Should not happen

      const finalUsageConfig = await trx<IPlanServiceUsageConfig>('plan_service_usage_config')
        .where({ config_id: configId, tenant: tenant })
        .first();

      if (!finalUsageConfig) throw new Error("Failed to retrieve usage config after upsert"); // Should not happen

      let finalTiers: IPlanServiceRateTier[] = [];
      if (finalUsageConfig.enable_tiered_pricing) {
        finalTiers = await trx<IPlanServiceRateTier>('plan_service_rate_tiers')
          .where({ config_id: configId, tenant: tenant })
          .orderBy('min_quantity', 'asc');
      }

      const result: IFullPlanServiceUsageConfiguration = {
        ...finalBaseConfig,
        unit_of_measure: finalUsageConfig.unit_of_measure,
        minimum_usage: finalUsageConfig.minimum_usage,
        enable_tiered_pricing: finalUsageConfig.enable_tiered_pricing,
        base_rate: finalUsageConfig.base_rate,
        tiers: finalTiers,
      };
      return result;

    }); // End transaction

    return updatedConfig;

  } catch (error) {
    console.error("Error upserting plan service configuration:", error);
    // TODO: Improve error handling, maybe return specific validation errors
    throw new Error("Failed to upsert plan service configuration.");
  }
}


/**
 * Input type for upserting plan service bucket configuration.
 */
export interface IUpsertPlanServiceBucketConfigurationInput {
  planId: string;
  serviceId: string;
  // Fields from IPlanServiceBucketConfig (excluding generated/tenant/config_id)
  total_hours?: number | null;
  billing_period?: string | null;
  overage_rate?: number | null;
  allow_rollover?: boolean;
}

/**
 * Upserts the bucket-specific configuration for a service within a plan.
 * This action ensures the base configuration exists and is set to type 'Bucket',
 * then creates or updates the associated bucket configuration record.
 */
export async function upsertPlanServiceBucketConfigurationAction(
  input: IUpsertPlanServiceBucketConfigurationInput
): Promise<string> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error("tenant context not found");
  }
  const configService = new PlanServiceConfigurationService(knex, tenant);

  const { planId, serviceId, ...bucketConfigData } = input;

  // Get service details to access default_rate
  const service = await knex('service_catalog')
    .where({
      service_id: serviceId,
      tenant
    })
    .first();

  if (!service) {
    throw new Error(`Service ${serviceId} not found`);
  }

  // Prepare the data, ensuring correct types and handling nulls if necessary
  const dataForService: Partial<Omit<IPlanServiceBucketConfig, 'config_id' | 'tenant' | 'created_at' | 'updated_at'>> = {
      total_hours: bucketConfigData.total_hours !== undefined && bucketConfigData.total_hours !== null ? Number(bucketConfigData.total_hours) : undefined,
      billing_period: bucketConfigData.billing_period !== undefined && bucketConfigData.billing_period !== null ? String(bucketConfigData.billing_period) : undefined,
      // Use service's default_rate if overage_rate is not provided
      // Use input rate if provided, otherwise use service default, falling back to 0 if service default is null/undefined
      overage_rate: (bucketConfigData.overage_rate !== undefined && bucketConfigData.overage_rate !== null) ? Number(bucketConfigData.overage_rate) : (service.default_rate ?? 0),
      allow_rollover: bucketConfigData.allow_rollover !== undefined ? Boolean(bucketConfigData.allow_rollover) : undefined,
  };

  try {
    console.log(`Upserting bucket config for plan ${planId}, service ${serviceId} with data:`, dataForService);
    const configId = await configService.upsertPlanServiceBucketConfiguration(
      planId,
      serviceId,
      dataForService
    );
    console.log(`Upsert successful, configId: ${configId}`);
    return configId;
  } catch (error) {
    console.error("Error in upsertPlanServiceBucketConfigurationAction:", error);
    // Consider more specific error handling/logging
    throw new Error("Failed to upsert bucket configuration.");
  }
}


// --- Hourly Configuration Actions ---

// Define Zod schema for input validation
const UpsertPlanServiceHourlyConfigurationInputSchema = z.object({
  planId: z.string().uuid({ message: "Invalid Plan ID format" }),
  serviceId: z.string().uuid({ message: "Invalid Service ID format" }),
  hourly_rate: z.coerce.number({ invalid_type_error: "Hourly rate must be a number" }) // Coerce to number
                 .min(0, { message: "Hourly rate cannot be negative" })
                 .nullable()
                 .optional(),
  minimum_billable_time: z.coerce.number({ invalid_type_error: "Minimum billable time must be a number" }) // Coerce to number
                           .min(0, { message: "Minimum billable time cannot be negative" })
                           .nullable()
                           .optional(),
  round_up_to_nearest: z.coerce.number({ invalid_type_error: "Round up value must be a number" }) // Coerce to number
                         .min(0, { message: "Round up value cannot be negative" })
                         .nullable()
                         .optional(),
});

type UpsertPlanServiceHourlyConfigurationInput = z.infer<typeof UpsertPlanServiceHourlyConfigurationInputSchema>;


/**
 * Upserts the hourly configuration (hourly_rate, minimum_billable_time, round_up_to_nearest)
 * for a specific service within a plan. Creates the base plan_service_configuration
 * record with type 'Hourly' if it doesn't exist.
 * Returns the config_id of the upserted configuration.
 */
export async function upsertPlanServiceHourlyConfiguration(
  input: UpsertPlanServiceHourlyConfigurationInput
): Promise<string> { // Changed return type to string (config_id)
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error("Tenant context not found");
  }

  // --- Validation ---
  const validationResult = UpsertPlanServiceHourlyConfigurationInputSchema.safeParse(input);
  if (!validationResult.success) {
    console.error("Validation failed for upsertPlanServiceHourlyConfiguration:", validationResult.error.errors);
    // Combine error messages for a clearer error
    const errorMessages = validationResult.error.errors.map(e => `${e.path.join('.') || 'input'}: ${e.message}`).join('; ');
    throw new Error(`Validation Error: ${errorMessages}`);
  }
  const validatedInput = validationResult.data;
  // --- End Validation ---

  const configService = new PlanServiceConfigurationService(knex, tenant);

  try {
    // Prepare the hourly config data object, converting nulls to undefined
    const hourlyConfigData: Partial<IPlanServiceHourlyConfig> = {
        hourly_rate: validatedInput.hourly_rate ?? undefined,
        minimum_billable_time: validatedInput.minimum_billable_time ?? undefined,
        round_up_to_nearest: validatedInput.round_up_to_nearest ?? undefined,
    };

    // Call the service method with separate arguments
    const configId = await configService.upsertPlanServiceHourlyConfiguration(
      validatedInput.planId,
      validatedInput.serviceId,
      hourlyConfigData
    );
    return configId; // Return the config_id
  } catch (error) {
    console.error("Error upserting plan service hourly configuration:", error);
    if (error instanceof Error) {
        throw new Error(`Failed to upsert plan service hourly configuration: ${error.message}`);
    } else {
        throw new Error("An unknown error occurred while upserting plan service hourly configuration.");
    }
  }
}