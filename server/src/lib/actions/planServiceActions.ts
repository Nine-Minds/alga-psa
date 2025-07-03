'use server';

import { withTransaction } from '@shared/db';
import { IPlanServiceRateTier, IUserTypeRate } from 'server/src/interfaces/planServiceConfiguration.interfaces';
import { IPlanService } from 'server/src/interfaces/billing.interfaces';
import { IService } from 'server/src/interfaces/billing.interfaces';
import {
  IPlanServiceConfiguration,
  IPlanServiceFixedConfig,
  IPlanServiceHourlyConfig,
  IPlanServiceUsageConfig,
  IPlanServiceBucketConfig
} from 'server/src/interfaces/planServiceConfiguration.interfaces';
import { PlanServiceConfigurationService } from 'server/src/lib/services/planServiceConfigurationService';
import * as planServiceConfigActions from 'server/src/lib/actions/planServiceConfigurationActions';
import { createTenantKnex } from 'server/src/lib/db';
import { Knex } from 'knex';

/**
 * Get all services for a plan
 */
export async function getPlanServices(planId: string): Promise<IPlanService[]> {
  const { knex: db, tenant } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    const services = await trx('plan_services')
      .where({
        plan_id: planId,
        tenant
      })
      .select('*');

    return services;
  });
}

/**
 * Get a specific service in a plan
 */
export async function getPlanService(planId: string, serviceId: string): Promise<IPlanService | null> {
  const { knex: db, tenant } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    const service = await trx('plan_services')
      .where({
        plan_id: planId,
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
export async function addServiceToPlan(
  planId: string,
  serviceId: string,
  quantity?: number,
  customRate?: number,
  configType?: 'Fixed' | 'Hourly' | 'Usage' | 'Bucket',
  typeConfig?: Partial<IPlanServiceFixedConfig | IPlanServiceHourlyConfig | IPlanServiceUsageConfig | IPlanServiceBucketConfig>
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
    .first() as IService & { service_type_billing_method?: 'fixed' | 'per_unit' }; // Add type info

  if (!serviceWithType) {
    throw new Error(`Service ${serviceId} not found`);
  }
  // Use serviceWithType which includes service_type_billing_method for logic below
  const service = serviceWithType; // Keep using 'service' variable name for compatibility with validation block

  // Get plan details
  const plan = await trx('billing_plans')
    .where({
      plan_id: planId,
      tenant
    })
    .first();

  if (!plan) {
    throw new Error(`Plan ${planId} not found`);
  }

  // --- BEGIN SERVER-SIDE VALIDATION ---
  if (plan.plan_type === 'Hourly' && service.billing_method === 'fixed') {
    throw new Error(`Cannot add a fixed-price service (${service.service_name}) to an hourly billing plan.`);
  } else if (plan.plan_type === 'Usage' && service.billing_method === 'fixed') {
    // Prevent adding fixed-price services to Usage-Based plans
    throw new Error(`Cannot add a fixed-price service (${service.service_name}) to a usage-based billing plan.`);
  }
  // TODO: Add other validation rules as needed (e.g., prevent hourly services on fixed plans?)
  // --- END SERVER-SIDE VALIDATION ---

  // Determine configuration type based on standard service type's billing method, prioritizing explicit configType
  let determinedConfigType: 'Fixed' | 'Hourly' | 'Usage' | 'Bucket'; // Bucket might need separate logic

  // Determine configuration type: Prioritize explicit param, then plan type, then service type
  if (configType) {
    determinedConfigType = configType;
  } else if (plan.plan_type === 'Bucket') { // Check if the plan itself is a Bucket plan
    determinedConfigType = 'Bucket';
  } else if (serviceWithType?.service_type_billing_method === 'fixed') {
    determinedConfigType = 'Fixed';
  } else if (serviceWithType?.service_type_billing_method === 'per_unit') {
    // Use the service's specific unit_of_measure for per_unit services on non-Bucket plans
    if (serviceWithType.unit_of_measure?.toLowerCase().includes('hour')) {
       determinedConfigType = 'Hourly';
    } else {
       determinedConfigType = 'Usage'; // Default for other per_unit types
    }
  } else {
    // Fallback for missing/unknown service billing method on non-Bucket plans
    console.warn(`Could not determine standard billing method for service type of ${serviceId} on a non-Bucket plan. Defaulting configuration type to 'Fixed'.`);
    determinedConfigType = 'Fixed';
  }

  const configurationType = determinedConfigType;

  // If this is a Bucket configuration and overage_rate is not provided, set it to the service's default_rate
  if (configurationType === 'Bucket') {
    typeConfig = typeConfig || {};
    if ((typeConfig as Partial<IPlanServiceBucketConfig>)?.overage_rate === undefined) {
      (typeConfig as Partial<IPlanServiceBucketConfig>).overage_rate = service.default_rate;
    }
  }

  // Check if the service is already in the plan
  const existingPlanService = await getPlanService(planId, serviceId);
  
  // If not, add it to the plan_services table
  if (!existingPlanService) {
    await trx('plan_services').insert({
      plan_id: planId,
      service_id: serviceId,
      tenant: tenant
    });
  }

  // Check if a configuration already exists for this plan-service combination
  const existingConfig = await planServiceConfigActions.getConfigurationForService(planId, serviceId);
  
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
        plan_id: planId,
        service_id: serviceId,
        configuration_type: configurationType,
        custom_rate: customRate,
        quantity: quantity || 1,
        tenant: tenant!
      },
      typeConfig || {}
    );
  }

    return configId;
  });
}

/**
 * Update a service in a plan
 */
export async function updatePlanService(
  planId: string,
  serviceId: string,
  updates: {
    quantity?: number;
    customRate?: number;
    typeConfig?: Partial<IPlanServiceFixedConfig | IPlanServiceHourlyConfig | IPlanServiceUsageConfig | IPlanServiceBucketConfig>;
  },
  rateTiers?: IPlanServiceRateTier[] // Add rateTiers here
): Promise<boolean> {
  const { knex: db, tenant } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {

  // Get configuration ID
  const config = await planServiceConfigActions.getConfigurationForService(planId, serviceId);

  if (!config) {
    throw new Error(`Configuration for service ${serviceId} in plan ${planId} not found`);
  }

  // Update configuration
  const baseUpdates: Partial<IPlanServiceConfiguration> = {};
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

    return true;
  });
}

/**
 * Remove a service from a plan
 */
export async function removeServiceFromPlan(planId: string, serviceId: string): Promise<boolean> {
  const { knex: db, tenant } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {

  // Get configuration ID
  const config = await planServiceConfigActions.getConfigurationForService(planId, serviceId);

  // Remove configuration if it exists
  if (config) {
    await planServiceConfigActions.deleteConfiguration(config.config_id);
  }

  // Remove the service from the plan_services table
  await trx('plan_services')
    .where({
      plan_id: planId,
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
export async function getPlanServicesWithConfigurations(planId: string): Promise<{
  service: IService & { service_type_name?: string };
  configuration: IPlanServiceConfiguration;
  typeConfig: IPlanServiceFixedConfig | IPlanServiceHourlyConfig | IPlanServiceUsageConfig | IPlanServiceBucketConfig | null;
  userTypeRates?: IUserTypeRate[]; // Add userTypeRates to the return type
}[]> {
  const { knex: db, tenant } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {

  // Get all configurations for the plan
  const configurations = await planServiceConfigActions.getConfigurationsForPlan(planId);

  // Get service details including service type name for each configuration
  const result = [];
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
      const hourlyConfigModel = new (await import('server/src/lib/models/planServiceHourlyConfig')).default(trx);
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
