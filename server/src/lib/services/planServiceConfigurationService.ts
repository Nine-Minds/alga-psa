import { Knex } from 'knex';
import { createTenantKnex } from 'server/src/lib/db';
import {
  IPlanServiceConfiguration,
  IPlanServiceFixedConfig,
  IPlanServiceHourlyConfig,
  IPlanServiceUsageConfig,
  IPlanServiceBucketConfig,
  IPlanServiceRateTier,
  IUserTypeRate
} from 'server/src/interfaces/planServiceConfiguration.interfaces';
import PlanServiceConfiguration from 'server/src/lib/models/planServiceConfiguration';
import PlanServiceFixedConfig from 'server/src/lib/models/planServiceFixedConfig';
import PlanServiceHourlyConfig from 'server/src/lib/models/planServiceHourlyConfig';
import PlanServiceUsageConfig from 'server/src/lib/models/planServiceUsageConfig';
import PlanServiceBucketConfig from 'server/src/lib/models/planServiceBucketConfig';
import BillingPlan from 'server/src/lib/models/billingPlan'; // Added import

export class PlanServiceConfigurationService {
  private knex: Knex;
  private tenant: string;
  private planServiceConfigModel: PlanServiceConfiguration;
  private fixedConfigModel: PlanServiceFixedConfig;
  private hourlyConfigModel: PlanServiceHourlyConfig;
  private usageConfigModel: PlanServiceUsageConfig;
  private bucketConfigModel: PlanServiceBucketConfig;
  // Removed billingPlanModel property

  constructor(knex?: Knex, tenant?: string) {
    this.knex = knex as Knex;
    this.tenant = tenant as string;
    this.planServiceConfigModel = new PlanServiceConfiguration(knex, tenant);
    this.fixedConfigModel = new PlanServiceFixedConfig(knex, tenant);
    this.hourlyConfigModel = new PlanServiceHourlyConfig(knex, tenant);
    this.usageConfigModel = new PlanServiceUsageConfig(knex, tenant);
    this.bucketConfigModel = new PlanServiceBucketConfig(knex, tenant);
    // Removed billingPlanModel initialization
  }

  /**
   * Initialize knex connection if not provided in constructor
   */
  private async initKnex() {
    if (!this.knex) {
      const { knex, tenant } = await createTenantKnex();
      if (!tenant) {
        throw new Error("tenant context not found");
      }
      this.knex = knex;
      this.tenant = tenant;
      
      // Initialize models with knex connection
      this.planServiceConfigModel = new PlanServiceConfiguration(knex, tenant);
      this.fixedConfigModel = new PlanServiceFixedConfig(knex, tenant);
      this.hourlyConfigModel = new PlanServiceHourlyConfig(knex, tenant);
      this.usageConfigModel = new PlanServiceUsageConfig(knex, tenant);
      this.bucketConfigModel = new PlanServiceBucketConfig(knex, tenant);
      // Removed billingPlanModel initialization
    }
  }

  /**
   * Get a plan service configuration with its type-specific configuration
   */
  async getConfigurationWithDetails(configId: string): Promise<{
    baseConfig: IPlanServiceConfiguration;
    typeConfig: IPlanServiceFixedConfig | IPlanServiceHourlyConfig | IPlanServiceUsageConfig | IPlanServiceBucketConfig | null;
    rateTiers?: IPlanServiceRateTier[];
    // userTypeRates removed as they are plan-wide for Hourly plans now
  }> {
    await this.initKnex();
    
    const baseConfig = await this.planServiceConfigModel.getById(configId);
    if (!baseConfig) {
      throw new Error(`Configuration with ID ${configId} not found`);
    }

    // Fetch the associated plan to check its type
    const plan = await BillingPlan.findById(baseConfig.plan_id);
    if (!plan) {
      // This case should ideally not happen if baseConfig exists, but handle defensively
      console.warn(`Plan with ID ${baseConfig.plan_id} not found for config ${configId}`);
      // Proceed using the baseConfig.configuration_type as fallback
    }
    
    let typeConfig = null;
    let rateTiers = undefined;
    // let userTypeRates = undefined; // Removed

    // If the plan is a Bucket plan, always fetch from bucket config table
    if (plan?.plan_type === 'Bucket') {
      typeConfig = await this.bucketConfigModel.getByConfigId(configId);
      // Note: Rate tiers and user type rates are not applicable to Bucket configs
    } else {
      // Otherwise, use the configuration_type from the base config record
      switch (baseConfig.configuration_type) {
        case 'Fixed':
          typeConfig = await this.fixedConfigModel.getByConfigId(configId);
          break;
          
        case 'Hourly':
          typeConfig = await this.hourlyConfigModel.getByConfigId(configId);
          // userTypeRates are now plan-wide, not fetched here
          // if (typeConfig) {
          //   userTypeRates = await this.hourlyConfigModel.getUserTypeRates(configId);
          // }          
          break;
          
        case 'Usage':
          typeConfig = await this.usageConfigModel.getByConfigId(configId);
          if (typeConfig && (typeConfig as IPlanServiceUsageConfig).enable_tiered_pricing) {
            rateTiers = await this.usageConfigModel.getRateTiers(configId);
          }
          break;
          
        case 'Bucket':
          // This case might occur if a service was initially Bucket type
          // but the plan type changed, or if the plan fetch failed.
          typeConfig = await this.bucketConfigModel.getByConfigId(configId);
          break;
      }
    }
    
    return {
      baseConfig,
      typeConfig,
      rateTiers,
      // userTypeRates // Removed
    };
  }

  /**
   * Create a new plan service configuration with its type-specific configuration
   */
  async createConfiguration(
    baseConfig: Omit<IPlanServiceConfiguration, 'config_id' | 'created_at' | 'updated_at'>,
    typeConfig: Partial<IPlanServiceFixedConfig | IPlanServiceHourlyConfig | IPlanServiceUsageConfig | IPlanServiceBucketConfig>,
    rateTiers?: Omit<IPlanServiceRateTier, 'tier_id' | 'config_id' | 'created_at' | 'updated_at'>[],
    userTypeRates?: Omit<IUserTypeRate, 'rate_id' | 'config_id' | 'created_at' | 'updated_at'>[]
  ): Promise<string> {
    await this.initKnex();
    
    // Use transaction to ensure all operations succeed or fail together
    return await this.knex.transaction(async (trx) => {
      // Create models with transaction
      const planServiceConfigModel = new PlanServiceConfiguration(trx, this.tenant);
      const fixedConfigModel = new PlanServiceFixedConfig(trx, this.tenant);
      const hourlyConfigModel = new PlanServiceHourlyConfig(trx, this.tenant);
      const usageConfigModel = new PlanServiceUsageConfig(trx, this.tenant);
      const bucketConfigModel = new PlanServiceBucketConfig(trx, this.tenant);
      
      // Create base configuration
      const configId = await planServiceConfigModel.create(baseConfig);
      // Create type-specific configuration
      switch (baseConfig.configuration_type) {
        case 'Fixed':
          await fixedConfigModel.create({
            config_id: configId,
            base_rate: (typeConfig as IPlanServiceFixedConfig)?.base_rate ?? null,
            enable_proration: (typeConfig as IPlanServiceFixedConfig)?.enable_proration ?? false,
            billing_cycle_alignment: (typeConfig as IPlanServiceFixedConfig)?.billing_cycle_alignment ?? 'start',
            tenant: this.tenant
          });
          break;
          
        case 'Hourly':
          // Ensure typeConfig has the required fields for the new hourly structure
          const hourlyData = typeConfig as Partial<IPlanServiceHourlyConfig>;
          if (!hourlyData || typeof hourlyData.hourly_rate === 'undefined') {
             throw new Error('Hourly rate is required for Hourly configuration type.');
          }
          await hourlyConfigModel.create({
            config_id: configId,
            hourly_rate: hourlyData.hourly_rate, // Use new field
            minimum_billable_time: hourlyData.minimum_billable_time ?? 15, // Use new field
            round_up_to_nearest: hourlyData.round_up_to_nearest ?? 15, // Use new field
            // Removed plan-wide fields: enable_overtime, overtime_rate, etc.
            tenant: this.tenant
          });
          
          // User type rates are plan-wide, not handled here anymore
          // if (userTypeRates && userTypeRates.length > 0) { ... }
          break;
          
        case 'Usage':
          await usageConfigModel.create({
            config_id: configId,
            unit_of_measure: (typeConfig as IPlanServiceUsageConfig)?.unit_of_measure ?? 'Unit',
            enable_tiered_pricing: (typeConfig as IPlanServiceUsageConfig)?.enable_tiered_pricing ?? false,
            minimum_usage: (typeConfig as IPlanServiceUsageConfig)?.minimum_usage ?? 0,
            tenant: this.tenant
          });
          
          // Add rate tiers if provided
          if (rateTiers && rateTiers.length > 0) {
            for (const tierData of rateTiers) {
              await usageConfigModel.addRateTier({
                config_id: configId,
                min_quantity: tierData.min_quantity,
                max_quantity: tierData.max_quantity,
                rate: tierData.rate,
                tenant: this.tenant
              });
            }
          }
          break;
          
        case 'Bucket':
          // Fetch service default rate for defaulting
          const service = await trx('service_catalog')
            .where({ service_id: baseConfig.service_id, tenant: this.tenant })
            .select('default_rate')
            .first();
          const serviceDefaultRate = service?.default_rate;

          await bucketConfigModel.create({
            config_id: configId,
            total_minutes: (typeConfig as IPlanServiceBucketConfig)?.total_minutes ?? 0,
            billing_period: (typeConfig as IPlanServiceBucketConfig)?.billing_period ?? 'monthly',
            // Use provided rate, else service default, else 0
            overage_rate: (typeConfig as IPlanServiceBucketConfig)?.overage_rate ?? serviceDefaultRate ?? 0,
            allow_rollover: (typeConfig as IPlanServiceBucketConfig)?.allow_rollover ?? false,
            tenant: this.tenant
          });
          break;
      }
      
      return configId;
    });
  }

  /**
   * Update a plan service configuration with its type-specific configuration
   */
  async updateConfiguration(
    configId: string,
    baseConfig?: Partial<IPlanServiceConfiguration>,
    typeConfig?: Partial<IPlanServiceFixedConfig | IPlanServiceHourlyConfig | IPlanServiceUsageConfig | IPlanServiceBucketConfig>,
    rateTiers?: IPlanServiceRateTier[], // Add rateTiers parameter
    // userTypeRates parameter removed as it's not used for hourly updates here
  ): Promise<boolean> {
    await this.initKnex();
    
    // Get current configuration to determine type
    const currentConfig = await this.planServiceConfigModel.getById(configId);
    if (!currentConfig) {
      throw new Error(`Configuration with ID ${configId} not found`);
    }
    
    // Use transaction to ensure all operations succeed or fail together
    return await this.knex.transaction(async (trx) => {
      // Create models with transaction
      const planServiceConfigModel = new PlanServiceConfiguration(trx, this.tenant);
      const fixedConfigModel = new PlanServiceFixedConfig(trx, this.tenant);
      const hourlyConfigModel = new PlanServiceHourlyConfig(trx, this.tenant);
      const usageConfigModel = new PlanServiceUsageConfig(trx, this.tenant);
      const bucketConfigModel = new PlanServiceBucketConfig(trx, this.tenant);
      
      // Update base configuration if provided
      if (baseConfig) {
        await planServiceConfigModel.update(configId, baseConfig);
      }
      
      // Update type-specific configuration if provided
      if (typeConfig) {
        switch (currentConfig.configuration_type) {
          case 'Fixed':
            await fixedConfigModel.update(configId, typeConfig as Partial<IPlanServiceFixedConfig>);
            break;
            
          case 'Hourly':
            // Ensure only hourly-specific fields from the new schema are passed
            const hourlyUpdateData = typeConfig as Partial<IPlanServiceHourlyConfig>;
            const updatePayload: Partial<IPlanServiceHourlyConfig> = {};
            if (typeof hourlyUpdateData.hourly_rate !== 'undefined') {
              updatePayload.hourly_rate = hourlyUpdateData.hourly_rate;
            }
            if (typeof hourlyUpdateData.minimum_billable_time !== 'undefined') {
              updatePayload.minimum_billable_time = hourlyUpdateData.minimum_billable_time;
            }
            if (typeof hourlyUpdateData.round_up_to_nearest !== 'undefined') {
              updatePayload.round_up_to_nearest = hourlyUpdateData.round_up_to_nearest;
            }
            
            if (Object.keys(updatePayload).length > 0) {
               await hourlyConfigModel.update(configId, updatePayload);
            }
            break;
            
          case 'Usage':
            await usageConfigModel.update(configId, typeConfig as Partial<IPlanServiceUsageConfig>);
            break;
            
          case 'Bucket':
            await bucketConfigModel.update(configId, typeConfig as Partial<IPlanServiceBucketConfig>);
            break;
        }
      }
      // Handle rate tiers update if provided and config type is Usage
      if (rateTiers && currentConfig.configuration_type === 'Usage') {
        // Delete existing rate tiers for this configuration
        await usageConfigModel.deleteRateTiersByConfigId(configId); // Assuming this method exists or will be added

        // Insert new rate tiers
        for (const tierData of rateTiers) {
          // Ensure tenant is set correctly and only pass necessary fields
          await usageConfigModel.addRateTier({
            config_id: configId,
            min_quantity: tierData.min_quantity,
            max_quantity: tierData.max_quantity,
            rate: tierData.rate,
            tenant: this.tenant // Ensure tenant is passed
          });
        }
      }
      // User type rates are plan-wide and not updated here.
      
      return true;
    });
  }

  /**
   * Delete a plan service configuration and its type-specific configuration
   */
  async deleteConfiguration(configId: string): Promise<boolean> {
    await this.initKnex();
    
    // Get current configuration to determine type
    const currentConfig = await this.planServiceConfigModel.getById(configId);
    if (!currentConfig) {
      throw new Error(`Configuration with ID ${configId} not found`);
    }
    
    // Use transaction to ensure all operations succeed or fail together
    return await this.knex.transaction(async (trx) => {
      // Create models with transaction
      const planServiceConfigModel = new PlanServiceConfiguration(trx, this.tenant);
      const fixedConfigModel = new PlanServiceFixedConfig(trx, this.tenant);
      const hourlyConfigModel = new PlanServiceHourlyConfig(trx, this.tenant);
      const usageConfigModel = new PlanServiceUsageConfig(trx, this.tenant);
      const bucketConfigModel = new PlanServiceBucketConfig(trx, this.tenant);

      // Explicitly delete type-specific configuration first (no CASCADE)
      switch (currentConfig.configuration_type) {
        case 'Fixed':
          await fixedConfigModel.delete(configId);
          break;
        case 'Hourly':
          // Explicitly delete from plan_service_hourly_configs first
          await hourlyConfigModel.delete(configId);
          break;
        case 'Usage':
          // Also delete rate tiers if applicable
          await usageConfigModel.deleteRateTiersByConfigId(configId);
          await usageConfigModel.delete(configId);
          break;
        case 'Bucket':
          await bucketConfigModel.delete(configId);
          break;
      }
      
      // Delete base configuration
      await planServiceConfigModel.delete(configId);
      
      return true;
    });
  }

  /**
   * Get all configurations for a plan
   */
  async getConfigurationsForPlan(planId: string): Promise<IPlanServiceConfiguration[]> {
    await this.initKnex();
    
    return await this.planServiceConfigModel.getByPlanId(planId);
  }

  /**
   * Get configuration for a specific service within a plan
   */
  async getConfigurationForService(planId: string, serviceId: string): Promise<IPlanServiceConfiguration | null> {
    await this.initKnex();
    
    return await this.planServiceConfigModel.getByPlanAndServiceId(planId, serviceId);
  }

  /**
   * Upserts the bucket-specific configuration for a service within a plan.
   * Ensures the base configuration exists and has type 'Bucket'.
   */
  async upsertPlanServiceBucketConfiguration(
    planId: string,
    serviceId: string,
    bucketConfigData: Partial<Omit<IPlanServiceBucketConfig, 'config_id' | 'tenant' | 'created_at' | 'updated_at'>>
  ): Promise<string> {
    await this.initKnex();

    return await this.knex.transaction(async (trx) => {
      // Create models with transaction
      const planServiceConfigModel = new PlanServiceConfiguration(trx, this.tenant);
      const bucketConfigModel = new PlanServiceBucketConfig(trx, this.tenant);

      // 1. Find existing base configuration
      let baseConfig = await planServiceConfigModel.getByPlanAndServiceId(planId, serviceId);
      let configId: string;

      if (!baseConfig) {
        // 2. Create base configuration if it doesn't exist, force type to Bucket
        console.log(`No base config found for plan ${planId}, service ${serviceId}. Creating one with type Bucket.`);
        const newBaseConfigData: Omit<IPlanServiceConfiguration, 'config_id' | 'created_at' | 'updated_at'> = {
          plan_id: planId,
          service_id: serviceId,
          configuration_type: 'Bucket', // Force type to Bucket
          // is_enabled: true, // Removed: Field does not exist on base config interface
          tenant: this.tenant,
        };
        configId = await planServiceConfigModel.create(newBaseConfigData);
        console.log(`Created base config with ID: ${configId}`);
      } else {
        configId = baseConfig.config_id;
        // 3. Update base configuration type if it's not Bucket
        if (baseConfig.configuration_type !== 'Bucket') {
          console.log(`Base config ${configId} type is ${baseConfig.configuration_type}. Updating to Bucket.`);
          await planServiceConfigModel.update(configId, { configuration_type: 'Bucket' });
        }
      }

      // 4. Upsert bucket-specific configuration
      const dataToUpsert = {
        ...bucketConfigData,
        config_id: configId,
        tenant: this.tenant,
      };

      // Try updating first
      const updatedCount = await bucketConfigModel.update(configId, dataToUpsert);

      if (!updatedCount) { // Check if update returned false (no rows affected)
        // If update didn't affect any rows (meaning it didn't exist), create it
        console.log(`No existing bucket config for ${configId}. Creating.`);
        // Ensure all required fields for creation are present, potentially using defaults
        const createData: Omit<IPlanServiceBucketConfig, 'created_at' | 'updated_at'> = {
            config_id: configId,
            total_minutes: bucketConfigData.total_minutes ?? 0, // Provide defaults if needed
            billing_period: bucketConfigData.billing_period ?? 'monthly',
            overage_rate: bucketConfigData.overage_rate ?? 0,
            allow_rollover: bucketConfigData.allow_rollover ?? false,
            tenant: this.tenant,
        };
        await bucketConfigModel.create(createData);
      } else {
         console.log(`Updated existing bucket config for ${configId}.`);
      }


      return configId;
    });
  }

  /**
   * Upserts the hourly-specific configuration for a service within a plan.
   * Ensures the base configuration exists and has type 'Hourly'.
   */
  async upsertPlanServiceHourlyConfiguration(
    planId: string,
    serviceId: string,
    hourlyConfigData: Partial<Omit<IPlanServiceHourlyConfig, 'config_id' | 'tenant' | 'created_at' | 'updated_at'>>
  ): Promise<string> {
    await this.initKnex();

    return await this.knex.transaction(async (trx) => {
      // Create models with transaction
      const planServiceConfigModel = new PlanServiceConfiguration(trx, this.tenant);
      const hourlyConfigModel = new PlanServiceHourlyConfig(trx, this.tenant);

      // 1. Find existing base configuration
      let baseConfig = await planServiceConfigModel.getByPlanAndServiceId(planId, serviceId);
      let configId: string;

      if (!baseConfig) {
        // 2. Create base configuration if it doesn't exist, force type to Hourly
        console.log(`No base config found for plan ${planId}, service ${serviceId}. Creating one with type Hourly.`);
        const newBaseConfigData: Omit<IPlanServiceConfiguration, 'config_id' | 'created_at' | 'updated_at'> = {
          plan_id: planId,
          service_id: serviceId,
          configuration_type: 'Hourly', // Force type to Hourly
          tenant: this.tenant,
        };
        configId = await planServiceConfigModel.create(newBaseConfigData);
        console.log(`Created base config with ID: ${configId}`);
      } else {
        configId = baseConfig.config_id;
        // 3. Update base configuration type if it's not Hourly
        if (baseConfig.configuration_type !== 'Hourly') {
          console.log(`Base config ${configId} type is ${baseConfig.configuration_type}. Updating to Hourly.`);
          await planServiceConfigModel.update(configId, { configuration_type: 'Hourly' });
        }
      }

      // 4. Upsert hourly-specific configuration
      const dataToUpsert = {
        ...hourlyConfigData,
        config_id: configId,
        tenant: this.tenant,
      };

      // Try updating first
      const updatedCount = await hourlyConfigModel.update(configId, dataToUpsert);

      if (!updatedCount) { // Check if update returned false (no rows affected)
        // If update didn't affect any rows (meaning it didn't exist), create it
        console.log(`No existing hourly config for ${configId}. Creating.`);
        // Ensure all required fields for creation are present
        if (typeof hourlyConfigData.hourly_rate === 'undefined') {
          throw new Error('Hourly rate is required when creating hourly configuration.');
        }
        const createData: Omit<IPlanServiceHourlyConfig, 'created_at' | 'updated_at'> = {
            config_id: configId,
            hourly_rate: hourlyConfigData.hourly_rate,
            minimum_billable_time: hourlyConfigData.minimum_billable_time ?? 15, // Provide defaults
            round_up_to_nearest: hourlyConfigData.round_up_to_nearest ?? 15, // Provide defaults
            tenant: this.tenant,
        };
        await hourlyConfigModel.create(createData);
      } else {
         console.log(`Updated existing hourly config for ${configId}.`);
      }

      return configId;
    });
  }

  /**
   * Upserts (replaces) all user type rates for a specific hourly configuration.
   * Deletes existing rates and inserts the provided ones within a transaction.
   */
  async upsertUserTypeRates(
    configId: string,
    rates: Omit<IUserTypeRate, 'rate_id' | 'config_id' | 'created_at' | 'updated_at' | 'tenant'>[]
  ): Promise<void> {
    await this.initKnex();

    // Ensure the config exists and is of type 'Hourly' before proceeding
    const baseConfig = await this.planServiceConfigModel.getById(configId);
    if (!baseConfig) {
      throw new Error(`Configuration with ID ${configId} not found.`);
    }
    if (baseConfig.configuration_type !== 'Hourly') {
      throw new Error(`Configuration with ID ${configId} is not an Hourly configuration.`);
    }

    await this.knex.transaction(async (trx) => {
      // Create model with transaction
      const hourlyConfigModel = new PlanServiceHourlyConfig(trx, this.tenant);

      // 1. Delete existing rates for this config_id
      await hourlyConfigModel.deleteUserTypeRatesByConfigId(configId); // Assuming this method exists or will be added

      // 2. Insert new rates if provided
      if (rates && rates.length > 0) {
        const ratesToInsert = rates.map(rate => ({
          ...rate,
          config_id: configId,
          tenant: this.tenant,
        }));
        await hourlyConfigModel.addUserTypeRates(ratesToInsert); // Assuming addUserTypeRates can handle an array
      }
    });
  }
}