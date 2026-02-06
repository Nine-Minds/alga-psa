import { Knex } from 'knex';
import { createTenantKnex } from 'server/src/lib/db';
import {
  IContractLineServiceConfiguration,
  IContractLineServiceFixedConfig,
  IContractLineServiceHourlyConfig,
  IContractLineServiceUsageConfig,
  IContractLineServiceBucketConfig,
  IContractLineServiceRateTier,
  IUserTypeRate
} from 'server/src/interfaces/contractLineServiceConfiguration.interfaces';
import ContractLineServiceConfiguration from '@alga-psa/billing/models/contractLineServiceConfiguration';
import ContractLineServiceFixedConfig from '@alga-psa/billing/models/contractLineServiceFixedConfig';
import ContractLineServiceHourlyConfig from '@alga-psa/billing/models/contractLineServiceHourlyConfig';
import ContractLineServiceUsageConfig from '@alga-psa/billing/models/contractLineServiceUsageConfig';
import ContractLineServiceBucketConfig from '@alga-psa/billing/models/contractLineServiceBucketConfig';

export class ContractLineServiceConfigurationService {
  private knex: Knex;
  private tenant: string;
  private planServiceConfigModel: ContractLineServiceConfiguration;
  private fixedConfigModel: ContractLineServiceFixedConfig;
  private hourlyConfigModel: ContractLineServiceHourlyConfig;
  private usageConfigModel: ContractLineServiceUsageConfig;
  private bucketConfigModel: ContractLineServiceBucketConfig;
  // Removed contractLineModel property

  constructor(knex?: Knex, tenant?: string) {
    this.knex = knex as Knex;
    this.tenant = tenant as string;
    if (knex) {
      this.planServiceConfigModel = new ContractLineServiceConfiguration(knex, tenant);
      this.fixedConfigModel = new ContractLineServiceFixedConfig(knex, tenant);
      this.hourlyConfigModel = new ContractLineServiceHourlyConfig(knex);
      this.usageConfigModel = new ContractLineServiceUsageConfig(knex);
      this.bucketConfigModel = new ContractLineServiceBucketConfig(knex, tenant);
    } else {
      // These will be initialized in initKnex
      this.planServiceConfigModel = {} as ContractLineServiceConfiguration;
      this.fixedConfigModel = {} as ContractLineServiceFixedConfig;
      this.hourlyConfigModel = {} as ContractLineServiceHourlyConfig;
      this.usageConfigModel = {} as ContractLineServiceUsageConfig;
      this.bucketConfigModel = {} as ContractLineServiceBucketConfig;
    }
    // Removed contractLineModel initialization
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
      this.planServiceConfigModel = new ContractLineServiceConfiguration(knex, tenant);
      this.fixedConfigModel = new ContractLineServiceFixedConfig(knex, tenant);
      this.hourlyConfigModel = new ContractLineServiceHourlyConfig(knex);
      this.usageConfigModel = new ContractLineServiceUsageConfig(knex);
      this.bucketConfigModel = new ContractLineServiceBucketConfig(knex, tenant);
      // Removed contractLineModel initialization
    }
  }

  /**
   * Get a plan service configuration with its type-specific configuration
   */
  async getConfigurationWithDetails(configId: string): Promise<{
    baseConfig: IContractLineServiceConfiguration;
    typeConfig: IContractLineServiceFixedConfig | IContractLineServiceHourlyConfig | IContractLineServiceUsageConfig | IContractLineServiceBucketConfig | null;
    rateTiers?: IContractLineServiceRateTier[];
    // userTypeRates removed as they are plan-wide for Hourly plans now
  }> {
    await this.initKnex();
    
    const baseConfig = await this.planServiceConfigModel.getById(configId);
    if (!baseConfig) {
      throw new Error(`Configuration with ID ${configId} not found`);
    }

    let typeConfig: IContractLineServiceBucketConfig | IContractLineServiceFixedConfig | IContractLineServiceHourlyConfig | IContractLineServiceUsageConfig | null = null;
    let rateTiers: IContractLineServiceRateTier[] | undefined = undefined;
    // let userTypeRates = undefined; // Removed

    // Use the configuration_type from the base config record
    switch (baseConfig.configuration_type) {
      case 'Fixed':
        typeConfig = await this.fixedConfigModel.getByConfigId(configId);
        break;

      case 'Hourly':
        typeConfig = await this.hourlyConfigModel.getByConfigId(configId);
        break;

      case 'Usage':
        typeConfig = await this.usageConfigModel.getByConfigId(configId);
        if (typeConfig && (typeConfig as IContractLineServiceUsageConfig).enable_tiered_pricing) {
          rateTiers = await this.usageConfigModel.getRateTiers(configId);
        }
        break;

      case 'Bucket':
        typeConfig = await this.bucketConfigModel.getByConfigId(configId);
        break;
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
    baseConfig: Omit<IContractLineServiceConfiguration, 'config_id' | 'created_at' | 'updated_at'>,
    typeConfig: Partial<IContractLineServiceFixedConfig | IContractLineServiceHourlyConfig | IContractLineServiceUsageConfig | IContractLineServiceBucketConfig>,
    rateTiers?: Omit<IContractLineServiceRateTier, 'tier_id' | 'config_id' | 'created_at' | 'updated_at'>[],
    userTypeRates?: Omit<IUserTypeRate, 'rate_id' | 'config_id' | 'created_at' | 'updated_at'>[]
  ): Promise<string> {
    await this.initKnex();
    
    // Use transaction to ensure all operations succeed or fail together
    return await this.knex.transaction(async (trx) => {
      // Create models with transaction
      const planServiceConfigModel = new ContractLineServiceConfiguration(trx, this.tenant);
      const fixedConfigModel = new ContractLineServiceFixedConfig(trx, this.tenant);
      const hourlyConfigModel = new ContractLineServiceHourlyConfig(trx);
      const usageConfigModel = new ContractLineServiceUsageConfig(trx);
      const bucketConfigModel = new ContractLineServiceBucketConfig(trx, this.tenant);
      
      // Create base configuration
      const configId = await planServiceConfigModel.create(baseConfig);
      // Create type-specific configuration
      switch (baseConfig.configuration_type) {
        case 'Fixed':
          await fixedConfigModel.create({
            config_id: configId,
            base_rate: (typeConfig as IContractLineServiceFixedConfig)?.base_rate ?? null,
            // enable_proration: (typeConfig as IContractLineServiceFixedConfig)?.enable_proration ?? false, // Removed: Handled in contract_line_fixed_config
            // billing_cycle_alignment: (typeConfig as IContractLineServiceFixedConfig)?.billing_cycle_alignment ?? 'start', // Removed: Handled in contract_line_fixed_config
            tenant: this.tenant
          });
          break;
          
        case 'Hourly':
          // Ensure typeConfig has the required fields for the new hourly structure
          const hourlyData = typeConfig as Partial<IContractLineServiceHourlyConfig>;
          if (!hourlyData || typeof hourlyData.hourly_rate === 'undefined') {
             throw new Error('Hourly rate is required for Hourly configuration type.');
          }
          await hourlyConfigModel.create({
            config_id: configId,
            hourly_rate: hourlyData.hourly_rate, // Use new field
            minimum_billable_time: hourlyData.minimum_billable_time ?? 15, // Use new field
            round_up_to_nearest: hourlyData.round_up_to_nearest ?? 15 // Use new field
            // Removed plan-wide fields: enable_overtime, overtime_rate, etc.
          });
          
          // User type rates are plan-wide, not handled here anymore
          // if (userTypeRates && userTypeRates.length > 0) { ... }
          break;
          
        case 'Usage':
          await usageConfigModel.create({
            config_id: configId,
            unit_of_measure: (typeConfig as IContractLineServiceUsageConfig)?.unit_of_measure ?? 'Unit',
            enable_tiered_pricing: (typeConfig as IContractLineServiceUsageConfig)?.enable_tiered_pricing ?? false,
            minimum_usage: (typeConfig as IContractLineServiceUsageConfig)?.minimum_usage ?? 0
          });
          
          // Add rate tiers if provided
          if (rateTiers && rateTiers.length > 0) {
            for (const tierData of rateTiers) {
              await usageConfigModel.addRateTier({
                config_id: configId,
                min_quantity: tierData.min_quantity,
                max_quantity: tierData.max_quantity,
                rate: tierData.rate
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

          // Fetch contract line to validate/set billing_period
          const ContractLine = (await import('@alga-psa/billing/models/contractLine')).default;
          const contractLine = await ContractLine.findById(trx, baseConfig.contract_line_id);
          if (!contractLine) {
            throw new Error(`Contract line ${baseConfig.contract_line_id} not found`);
          }

          const bucketBillingPeriod = (typeConfig as IContractLineServiceBucketConfig)?.billing_period;
          // Validate billing_period matches contract line's billing_frequency
          if (bucketBillingPeriod && bucketBillingPeriod !== contractLine.billing_frequency) {
            throw new Error(
              `Bucket billing period (${bucketBillingPeriod}) must match contract line billing frequency (${contractLine.billing_frequency})`
            );
          }

          await bucketConfigModel.create({
            config_id: configId,
            total_minutes: (typeConfig as IContractLineServiceBucketConfig)?.total_minutes ?? 0,
            billing_period: bucketBillingPeriod ?? contractLine.billing_frequency,
            // Use provided rate, else service default, else 0
            overage_rate: (typeConfig as IContractLineServiceBucketConfig)?.overage_rate ?? serviceDefaultRate ?? 0,
            allow_rollover: (typeConfig as IContractLineServiceBucketConfig)?.allow_rollover ?? false,
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
    baseConfig?: Partial<IContractLineServiceConfiguration>,
    typeConfig?: Partial<IContractLineServiceFixedConfig | IContractLineServiceHourlyConfig | IContractLineServiceUsageConfig | IContractLineServiceBucketConfig>,
    rateTiers?: IContractLineServiceRateTier[], // Add rateTiers parameter
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
      const planServiceConfigModel = new ContractLineServiceConfiguration(trx, this.tenant);
      const fixedConfigModel = new ContractLineServiceFixedConfig(trx, this.tenant);
      const hourlyConfigModel = new ContractLineServiceHourlyConfig(trx);
      const usageConfigModel = new ContractLineServiceUsageConfig(trx);
      const bucketConfigModel = new ContractLineServiceBucketConfig(trx, this.tenant);
      
      // Update base configuration if provided
      if (baseConfig) {
        await planServiceConfigModel.update(configId, baseConfig);
      }
      
      // Update type-specific configuration if provided
      if (typeConfig) {
        switch (currentConfig.configuration_type) {
          case 'Fixed':
            // Proration and alignment fields are no longer part of IContractLineServiceFixedConfig
            // The typeConfig passed in should already only contain allowed fields (like base_rate)
            const fixedUpdateData = { ...typeConfig } as Partial<IContractLineServiceFixedConfig>;
            // delete fixedUpdateData.enable_proration; // Removed as property no longer exists
            // delete fixedUpdateData.billing_cycle_alignment; // Removed as property no longer exists
            // Only update if there are other fields left (e.g., base_rate)
            if (Object.keys(fixedUpdateData).length > 0) {
              await fixedConfigModel.update(configId, fixedUpdateData);
            }
            break;
            
          case 'Hourly':
            // Ensure only hourly-specific fields from the new schema are passed
            const hourlyUpdateData = typeConfig as Partial<IContractLineServiceHourlyConfig>;
            const updatePayload: Partial<IContractLineServiceHourlyConfig> = {};
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
            await usageConfigModel.update(configId, typeConfig as Partial<IContractLineServiceUsageConfig>);
            break;
            
          case 'Bucket':
            await bucketConfigModel.update(configId, typeConfig as Partial<IContractLineServiceBucketConfig>);
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
            rate: tierData.rate
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
      const planServiceConfigModel = new ContractLineServiceConfiguration(trx, this.tenant);
      const fixedConfigModel = new ContractLineServiceFixedConfig(trx, this.tenant);
      const hourlyConfigModel = new ContractLineServiceHourlyConfig(trx);
      const usageConfigModel = new ContractLineServiceUsageConfig(trx);
      const bucketConfigModel = new ContractLineServiceBucketConfig(trx, this.tenant);

      // Explicitly delete type-specific configuration first (no CASCADE)
      switch (currentConfig.configuration_type) {
        case 'Fixed':
          await fixedConfigModel.delete(configId);
          break;
        case 'Hourly':
          // Explicitly delete from contract_line_service_hourly_configs first
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
  async getConfigurationsForPlan(contractLineId: string): Promise<IContractLineServiceConfiguration[]> {
    await this.initKnex();
    
    return await this.planServiceConfigModel.getByContractLineId(contractLineId);
  }

  /**
   * Get configuration for a specific service within a plan
   */
  async getConfigurationForService(contractLineId: string, serviceId: string): Promise<IContractLineServiceConfiguration | null> {
    await this.initKnex();
    
    return await this.planServiceConfigModel.getByContractLineIdAndServiceId(contractLineId, serviceId);
  }

  /**
   * Upserts the bucket-specific configuration for a service within a plan.
   * Ensures the base configuration exists and has type 'Bucket'.
   */
  async upsertPlanServiceBucketConfiguration(
    contractLineId: string,
    serviceId: string,
    bucketConfigData: Partial<Omit<IContractLineServiceBucketConfig, 'config_id' | 'tenant' | 'created_at' | 'updated_at'>>
  ): Promise<string> {
    await this.initKnex();

    return await this.knex.transaction(async (trx) => {
      // Create models with transaction
      const planServiceConfigModel = new ContractLineServiceConfiguration(trx, this.tenant);
      const bucketConfigModel = new ContractLineServiceBucketConfig(trx, this.tenant);
      const ContractLine = (await import('@alga-psa/billing/models/contractLine')).default;

      // 0. Fetch contract line and validate/set bucket billing_period
      const contractLine = await ContractLine.findById(trx, contractLineId);
      if (!contractLine) {
        throw new Error(`Contract line ${contractLineId} not found`);
      }

      // Validate or set billing_period to match contract line's billing_frequency
      if (bucketConfigData.billing_period) {
        if (bucketConfigData.billing_period !== contractLine.billing_frequency) {
          throw new Error(
            `Bucket billing period (${bucketConfigData.billing_period}) must match contract line billing frequency (${contractLine.billing_frequency})`
          );
        }
      } else {
        // Auto-set billing_period to match contract line's billing_frequency
        bucketConfigData.billing_period = contractLine.billing_frequency;
      }

      // 1. Find existing base configuration
      let baseConfig = await planServiceConfigModel.getByContractLineIdAndServiceId(contractLineId, serviceId);
      let configId: string;

      if (!baseConfig) {
        // 2. Create base configuration if it doesn't exist, force type to Bucket
        console.log(`No base config found for contract line ${contractLineId}, service ${serviceId}. Creating one with type Bucket.`);
        const newBaseConfigData: Omit<IContractLineServiceConfiguration, 'config_id' | 'created_at' | 'updated_at'> = {
          contract_line_id: contractLineId,
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
        const createData: Omit<IContractLineServiceBucketConfig, 'created_at' | 'updated_at'> = {
            config_id: configId,
            total_minutes: bucketConfigData.total_minutes ?? 0, // Provide defaults if needed
            billing_period: bucketConfigData.billing_period ?? contractLine.billing_frequency,
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
    contractLineId: string,
    serviceId: string,
    hourlyConfigData: Partial<Omit<IContractLineServiceHourlyConfig, 'config_id' | 'tenant' | 'created_at' | 'updated_at'>>
  ): Promise<string> {
    await this.initKnex();

    return await this.knex.transaction(async (trx) => {
      // Create models with transaction
      const planServiceConfigModel = new ContractLineServiceConfiguration(trx, this.tenant);
      const hourlyConfigModel = new ContractLineServiceHourlyConfig(trx);

      // 1. Find existing base configuration
      let baseConfig = await planServiceConfigModel.getByContractLineIdAndServiceId(contractLineId, serviceId);
      let configId: string;

      if (!baseConfig) {
        // 2. Create base configuration if it doesn't exist, force type to Hourly
        console.log(`No base config found for contract line ${contractLineId}, service ${serviceId}. Creating one with type Hourly.`);
        const newBaseConfigData: Omit<IContractLineServiceConfiguration, 'config_id' | 'created_at' | 'updated_at'> = {
          contract_line_id: contractLineId,
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
        const createData: Omit<IContractLineServiceHourlyConfig, 'created_at' | 'updated_at'> = {
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
   * Upserts the usage-specific configuration for a service within a plan.
   * Ensures the base configuration exists and has type 'Usage'.
   */
  async upsertPlanServiceUsageConfiguration(
    contractLineId: string,
    serviceId: string,
    usageConfigData: {
      unit_rate?: number;
      unit_of_measure?: string;
      enable_tiered_pricing?: boolean;
      minimum_usage?: number | null;
    }
  ): Promise<string> {
    await this.initKnex();

    return await this.knex.transaction(async (trx) => {
      const planServiceConfigModel = new ContractLineServiceConfiguration(trx, this.tenant);
      const usageConfigModel = new ContractLineServiceUsageConfig(trx);

      const normalizedUnitRate = Math.max(0, Math.round(usageConfigData.unit_rate ?? 0));
      let baseConfig = await planServiceConfigModel.getByContractLineIdAndServiceId(contractLineId, serviceId);
      let configId: string;

      if (!baseConfig) {
        const newBaseConfig: Omit<IContractLineServiceConfiguration, 'config_id' | 'created_at' | 'updated_at'> = {
          contract_line_id: contractLineId,
          service_id: serviceId,
          configuration_type: 'Usage',
          custom_rate: normalizedUnitRate,
          quantity: undefined,
          tenant: this.tenant,
        };
        configId = await planServiceConfigModel.create(newBaseConfig);
      } else {
        configId = baseConfig.config_id;
        const updatePayload: Partial<IContractLineServiceConfiguration> = {
          custom_rate: normalizedUnitRate,
        };
        if (baseConfig.configuration_type !== 'Usage') {
          updatePayload.configuration_type = 'Usage';
        }
        await planServiceConfigModel.update(configId, updatePayload);
      }

      const usagePayload = {
        unit_of_measure: usageConfigData.unit_of_measure ?? 'unit',
        enable_tiered_pricing: usageConfigData.enable_tiered_pricing ?? false,
        minimum_usage: usageConfigData.minimum_usage ?? 0,
        base_rate: normalizedUnitRate,
      };

      const existingUsage = await usageConfigModel.getByConfigId(configId);
      if (existingUsage) {
        await usageConfigModel.update(configId, usagePayload);
      } else {
        await usageConfigModel.create({
          config_id: configId,
          ...usagePayload,
        });
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
      const hourlyConfigModel = new ContractLineServiceHourlyConfig(trx);

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
