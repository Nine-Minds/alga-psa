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
    userTypeRates?: IUserTypeRate[];
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
    let userTypeRates = undefined;

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
          if (typeConfig) {
            userTypeRates = await this.hourlyConfigModel.getUserTypeRates(configId);
          }
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
      userTypeRates
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
            enable_proration: (typeConfig as IPlanServiceFixedConfig)?.enable_proration ?? false,
            billing_cycle_alignment: (typeConfig as IPlanServiceFixedConfig)?.billing_cycle_alignment ?? 'start',
            tenant: this.tenant
          });
          break;
          
        case 'Hourly':
          await hourlyConfigModel.create({
            config_id: configId,
            minimum_billable_time: (typeConfig as IPlanServiceHourlyConfig)?.minimum_billable_time ?? 15,
            round_up_to_nearest: (typeConfig as IPlanServiceHourlyConfig)?.round_up_to_nearest ?? 15,
            enable_overtime: (typeConfig as IPlanServiceHourlyConfig)?.enable_overtime ?? false,
            overtime_rate: (typeConfig as IPlanServiceHourlyConfig)?.overtime_rate,
            overtime_threshold: (typeConfig as IPlanServiceHourlyConfig)?.overtime_threshold,
            enable_after_hours_rate: (typeConfig as IPlanServiceHourlyConfig)?.enable_after_hours_rate ?? false,
            after_hours_multiplier: (typeConfig as IPlanServiceHourlyConfig)?.after_hours_multiplier,
            tenant: this.tenant
          });
          
          // Add user type rates if provided
          if (userTypeRates && userTypeRates.length > 0) {
            for (const rateData of userTypeRates) {
              await hourlyConfigModel.addUserTypeRate({
                config_id: configId,
                user_type: rateData.user_type,
                rate: rateData.rate,
                tenant: this.tenant
              });
            }
          }
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
          await bucketConfigModel.create({
            config_id: configId,
            total_hours: (typeConfig as IPlanServiceBucketConfig)?.total_hours ?? 0,
            billing_period: (typeConfig as IPlanServiceBucketConfig)?.billing_period ?? 'monthly',
            overage_rate: (typeConfig as IPlanServiceBucketConfig)?.overage_rate ?? 0,
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
    rateTiers?: IPlanServiceRateTier[] // Add rateTiers parameter
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
            await hourlyConfigModel.update(configId, typeConfig as Partial<IPlanServiceHourlyConfig>);
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
      // TODO: Add similar logic for userTypeRates if needed for Hourly config updates
      
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
      
      // Delete base configuration (will cascade to type-specific configurations)
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
            total_hours: bucketConfigData.total_hours ?? 0, // Provide defaults if needed
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
}