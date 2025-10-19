'use server';

import { withTransaction } from '@alga-psa/shared/db';
import { IContractLineServiceRateTier, IUserTypeRate, IContractLineServiceConfiguration, IContractLineServiceFixedConfig, IContractLineServiceHourlyConfig, IContractLineServiceUsageConfig, IContractLineServiceBucketConfig } from 'server/src/interfaces/contractLineServiceConfiguration.interfaces';
import { IContractLineService } from 'server/src/interfaces/billing.interfaces';
import { IService } from 'server/src/interfaces/billing.interfaces';
 
import { ContractLineServiceConfigurationService } from 'server/src/lib/services/contractLineServiceConfigurationService';
import * as planServiceConfigActions from 'server/src/lib/actions/contractLineServiceConfigurationActions';
import { createTenantKnex } from 'server/src/lib/db';
import { Knex } from 'knex';

/**
 * Get all services for a plan
 */
export async function getContractLineServices(contractLineId: string): Promise<IContractLineService[]> {
  const { knex: db, tenant } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    const services = await trx('contract_line_services')
      .where({
        contract_line_id: contractLineId,
        tenant
      })
      .select('*');

    return services;
  });
}

/**
 * Get a specific service in a plan
 */
export async function getContractLineService(contractLineId: string, serviceId: string): Promise<IContractLineService | null> {
  const { knex: db, tenant } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    const service = await trx('contract_line_services')
      .where({
        contract_line_id: contractLineId,
        service_id: serviceId,
        tenant
      })
      .first();

    return service || null;
  });
}

/**
 * Add a service to a plan with configuration
 */
export async function addServiceToContractLine(
  contractLineId: string,
  serviceId: string,
  quantity?: number,
  customRate?: number,
  configType?: 'Fixed' | 'Hourly' | 'Usage' | 'Bucket',
  typeConfig?: Partial<IContractLineServiceFixedConfig | IContractLineServiceHourlyConfig | IContractLineServiceUsageConfig | IContractLineServiceBucketConfig>
): Promise<string> {
  const { knex: db, tenant } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {

  // Get service details and join with service_types to get the type's billing_method
  const serviceWithType = await trx('service_catalog as sc')
    .leftJoin('service_types as st', function() {
      this.on('sc.custom_service_type_id', '=', 'st.id')
          .andOn('sc.tenant', '=', 'st.tenant');
    })
    .where({
      'sc.service_id': serviceId,
      'sc.tenant': tenant
    })
    .select('sc.*', 'st.billing_method as service_type_billing_method') // Select the billing_method from the type table
    .first() as IService & { service_type_billing_method?: 'fixed' | 'hourly' | 'usage' }; // Add type info

  if (!serviceWithType) {
    throw new Error(`Service ${serviceId} not found`);
  }
  // Use serviceWithType which includes service_type_billing_method for logic below
  const service = serviceWithType; // Keep using 'service' variable name for compatibility with validation block

  // Get plan details
  const plan = await trx('contract_lines')
    .where({
      contract_line_id: contractLineId,
      tenant
    })
    .first();

  if (!plan) {
    throw new Error(`Contract line ${contractLineId} not found`);
  }

  // --- BEGIN SERVER-SIDE VALIDATION ---
  if (plan.contract_line_type === 'Hourly' && service.billing_method === 'fixed') {
    throw new Error(`Cannot add a fixed-price service (${service.service_name}) to an hourly contract line.`);
  } else if (plan.contract_line_type === 'Usage' && service.billing_method === 'fixed') {
    // Prevent adding fixed-price services to Usage-Based plans
    throw new Error(`Cannot add a fixed-price service (${service.service_name}) to a usage-based contract line.`);
  }
  // TODO: Add other validation rules as needed (e.g., prevent hourly services on fixed plans?)
  // --- END SERVER-SIDE VALIDATION ---

  // Determine configuration type based on standard service type's billing method, prioritizing explicit configType
  let determinedConfigType: 'Fixed' | 'Hourly' | 'Usage' | 'Bucket'; // Bucket might need separate logic

  // Determine configuration type: Prioritize explicit param, then plan type, then service type
  if (configType) {
    determinedConfigType = configType;
  } else if (serviceWithType?.service_type_billing_method === 'fixed') {
    determinedConfigType = 'Fixed';
  } else if (serviceWithType?.service_type_billing_method === 'hourly') {
    determinedConfigType = 'Hourly';
  } else if (serviceWithType?.service_type_billing_method === 'usage') {
    determinedConfigType = 'Usage';
  } else {
    // Fallback for missing/unknown service billing method on non-Bucket plans
    console.warn(`Could not determine standard billing method for service type of ${serviceId} on a non-Bucket plan. Defaulting configuration type to 'Fixed'.`);
    determinedConfigType = 'Fixed';
  }

  const configurationType = determinedConfigType;
  let hourlyConfigPayload: Partial<IContractLineServiceHourlyConfig> | undefined;

  // If this is a Bucket configuration and overage_rate is not provided, set it to the service's default_rate
  if (configurationType === 'Bucket') {
    typeConfig = typeConfig || {};
    if ((typeConfig as Partial<IContractLineServiceBucketConfig>)?.overage_rate === undefined) {
      (typeConfig as Partial<IContractLineServiceBucketConfig>).overage_rate = service.default_rate;
    }
  } else if (configurationType === 'Hourly') {
    const providedHourly = (typeConfig as Partial<IContractLineServiceHourlyConfig>) || {};
    const resolvedHourlyRate =
      typeof providedHourly.hourly_rate !== 'undefined'
        ? providedHourly.hourly_rate
        : service.default_rate;

    if (resolvedHourlyRate === undefined || resolvedHourlyRate === null) {
      throw new Error(`Service ${service.service_name} requires an hourly rate before it can be added to an hourly contract line.`);
    }

    const normalizedHourlyRate = Number(resolvedHourlyRate);
    if (Number.isNaN(normalizedHourlyRate)) {
      throw new Error(`Hourly rate for service ${service.service_name} must be a numeric value.`);
    }

    const minimumBillableCandidate = Number(
      typeof providedHourly.minimum_billable_time !== 'undefined'
        ? providedHourly.minimum_billable_time
        : 15
    );
    const roundUpCandidate = Number(
      typeof providedHourly.round_up_to_nearest !== 'undefined'
        ? providedHourly.round_up_to_nearest
        : 15
    );

    const minimumBillableTime = Number.isFinite(minimumBillableCandidate) && minimumBillableCandidate > 0
      ? minimumBillableCandidate
      : 15;
    const roundUpToNearest = Number.isFinite(roundUpCandidate) && roundUpCandidate > 0
      ? roundUpCandidate
      : 15;

    hourlyConfigPayload = {
      hourly_rate: normalizedHourlyRate,
      minimum_billable_time: minimumBillableTime,
      round_up_to_nearest: roundUpToNearest,
    };

    typeConfig = hourlyConfigPayload;
  }

  // Check if the service is already in the plan
  const existingPlanService = await getContractLineService(contractLineId, serviceId);
  
  // If not, add it to the contract_line_services table
  if (!existingPlanService) {
    await trx('contract_line_services').insert({
      contract_line_id: contractLineId,
      service_id: serviceId,
      tenant: tenant
    });
  }

  // Check if a configuration already exists for this plan-service combination
  const existingConfig = await planServiceConfigActions.getConfigurationForService(contractLineId, serviceId);
  
  let configId: string;
  
  if (existingConfig) {
    // Update existing configuration instead of creating a new one
    await planServiceConfigActions.updateConfiguration(
      existingConfig.config_id,
      {
        configuration_type: configurationType,
        custom_rate: customRate,
        quantity: quantity || 1
      },
      typeConfig || {}
    );
    configId = existingConfig.config_id;
  } else {
    // Create new configuration if one doesn't exist
    configId = await planServiceConfigActions.createConfiguration(
      {
        contract_line_id: contractLineId,
        service_id: serviceId,
        configuration_type: configurationType,
        custom_rate: customRate,
        quantity: quantity || 1,
        tenant: tenant!
      },
      typeConfig || {}
    );
  }

  if (configurationType === 'Hourly' && hourlyConfigPayload) {
    await planServiceConfigActions.upsertPlanServiceHourlyConfiguration(
      contractLineId,
      serviceId,
      hourlyConfigPayload
    );
  }

    return configId;
  });
}

/**
 * Update a service in a plan
 */
export async function updateContractLineService(
  contractLineId: string,
  serviceId: string,
  updates: {
    quantity?: number;
    customRate?: number;
    typeConfig?: Partial<IContractLineServiceFixedConfig | IContractLineServiceHourlyConfig | IContractLineServiceUsageConfig | IContractLineServiceBucketConfig>;
  },
  rateTiers?: IContractLineServiceRateTier[] // Add rateTiers here
): Promise<boolean> {
  const { knex: db, tenant } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {

  // Get configuration ID
  const config = await planServiceConfigActions.getConfigurationForService(contractLineId, serviceId);

  if (!config) {
    throw new Error(`Configuration for service ${serviceId} in contract line ${contractLineId} not found`);
  }

  // Update configuration
  const baseUpdates: Partial<IContractLineServiceConfiguration> = {};
  if (updates.quantity !== undefined) {
    baseUpdates.quantity = updates.quantity;
  }
  if (updates.customRate !== undefined) {
    baseUpdates.custom_rate = updates.customRate;
  }

  await planServiceConfigActions.updateConfiguration(
    config.config_id,
    Object.keys(baseUpdates).length > 0 ? baseUpdates : undefined,
    updates.typeConfig,
      // Pass rateTiers if they exist
      rateTiers // Pass the rateTiers variable directly
    );

  if (
    config.configuration_type === 'Hourly' &&
    updates.typeConfig &&
    typeof (updates.typeConfig as IContractLineServiceHourlyConfig).hourly_rate !== 'undefined'
  ) {
    const hourlyPayload: Partial<IContractLineServiceHourlyConfig> = {
      hourly_rate: (updates.typeConfig as IContractLineServiceHourlyConfig).hourly_rate,
      minimum_billable_time: (updates.typeConfig as IContractLineServiceHourlyConfig).minimum_billable_time,
      round_up_to_nearest: (updates.typeConfig as IContractLineServiceHourlyConfig).round_up_to_nearest,
    };

    await planServiceConfigActions.upsertPlanServiceHourlyConfiguration(
      contractLineId,
      serviceId,
      hourlyPayload
    );
  }

    return true;
  });
}

/**
 * Remove a service from a plan
 */
export async function removeServiceFromContractLine(contractLineId: string, serviceId: string): Promise<boolean> {
  const { knex: db, tenant } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {

  // Get configuration ID
  const config = await planServiceConfigActions.getConfigurationForService(contractLineId, serviceId);

  // Remove configuration if it exists
  if (config) {
    await planServiceConfigActions.deleteConfiguration(config.config_id);
  }

  // Remove the service from the contract_line_services table
  await trx('contract_line_services')
    .where({
      contract_line_id: contractLineId,
      service_id: serviceId,
      tenant
    })
      .delete();

    return true;
  });
}

/**
 * Get all services in a plan with their configurations, service type name, and user type rates (for hourly).
 */
export async function getContractLineServicesWithConfigurations(contractLineId: string): Promise<{
  service: IService & { service_type_name?: string };
  configuration: IContractLineServiceConfiguration;
  typeConfig: IContractLineServiceFixedConfig | IContractLineServiceHourlyConfig | IContractLineServiceUsageConfig | IContractLineServiceBucketConfig | null;
  userTypeRates?: IUserTypeRate[]; // Add userTypeRates to the return type
}[]> {
  const { knex: db, tenant } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {

  // Get all configurations for the plan
  const configurations = await planServiceConfigActions.getConfigurationsForPlan(contractLineId);

  // Get service details including service type name for each configuration
  const result: Array<{ service: IService & { service_type_name?: string }; configuration: IContractLineServiceConfiguration; typeConfig: IContractLineServiceFixedConfig | IContractLineServiceHourlyConfig | IContractLineServiceUsageConfig | IContractLineServiceBucketConfig | null; userTypeRates?: IUserTypeRate[] }> = [];
  for (const config of configurations) {
    // Join service_catalog with service_types to get the name
    const service = await trx('service_catalog as sc')
      .leftJoin('service_types as st', function() {
        this.on('sc.custom_service_type_id', '=', 'st.id')
            .andOn('sc.tenant', '=', 'st.tenant');
      })
      .where({
        'sc.service_id': config.service_id,
        'sc.tenant': tenant
      })
      .select('sc.*', 'st.name as service_type_name')
      .first() as IService & { service_type_name?: string }; // Cast to include the new field

    if (!service) {
      continue;
    }

    const configDetails = await planServiceConfigActions.getConfigurationWithDetails(config.config_id);

    let userTypeRates: IUserTypeRate[] | undefined = undefined;

    // If it's an hourly config, fetch user type rates
    if (config.configuration_type === 'Hourly') {
      // Assuming PlanServiceHourlyConfig model is accessible or we use an action
      // For simplicity, let's assume we can access the model instance via the service
      // This might need adjustment based on actual service/model structure
      const hourlyConfigModel = new (await import('server/src/lib/models/contractLineServiceHourlyConfig')).default(trx);
      userTypeRates = await hourlyConfigModel.getUserTypeRates(config.config_id);
    }

    result.push({
      service,
      configuration: config,
      typeConfig: configDetails.typeConfig,
      userTypeRates: userTypeRates // Add the fetched rates
      });
    }

    return result;
  });
}

export async function getTemplateLineServicesWithConfigurations(templateLineId: string): Promise<{
  service: IService & { service_type_name?: string };
  configuration: IContractLineServiceConfiguration;
  typeConfig: IContractLineServiceHourlyConfig | IContractLineServiceUsageConfig | IContractLineServiceBucketConfig | null;
}[]> {
  const { knex: db, tenant } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    const configurations = await trx('contract_template_line_service_configuration')
      .where({
        tenant,
        template_line_id: templateLineId,
      })
      .select('*');

    const results: Array<{
      service: IService & { service_type_name?: string };
      configuration: IContractLineServiceConfiguration;
      typeConfig:
        | IContractLineServiceHourlyConfig
        | IContractLineServiceUsageConfig
        | IContractLineServiceBucketConfig
        | null;
    }> = [];

    for (const config of configurations) {
      const service = await trx('service_catalog as sc')
        .leftJoin('service_types as st', function joinTypes() {
          this.on('sc.custom_service_type_id', '=', 'st.id')
            .andOn('sc.tenant', '=', 'st.tenant');
        })
        .where({
          'sc.service_id': config.service_id,
          'sc.tenant': tenant,
        })
        .select('sc.*', 'st.name as service_type_name')
        .first() as (IService & { service_type_name?: string }) | undefined;

      if (!service) {
        continue;
      }

      let typeConfig:
        | IContractLineServiceHourlyConfig
        | IContractLineServiceUsageConfig
        | IContractLineServiceBucketConfig
        | null = null;

      if (config.configuration_type === 'Bucket') {
        typeConfig = await trx('contract_template_line_service_bucket_config')
          .where({
            tenant,
            config_id: config.config_id,
          })
          .first();
      } else if (config.configuration_type === 'Hourly') {
        typeConfig = await trx('contract_template_line_service_hourly_config')
          .where({
            tenant,
            config_id: config.config_id,
          })
          .first();
      } else if (config.configuration_type === 'Usage') {
        typeConfig = await trx('contract_template_line_service_usage_config')
          .where({
            tenant,
            config_id: config.config_id,
          })
          .first();
      }

      const configuration: IContractLineServiceConfiguration = {
        ...config,
        contract_line_id: config.template_line_id,
      };

      results.push({
        service,
        configuration,
        typeConfig,
      });
    }

    return results;
  });
}
