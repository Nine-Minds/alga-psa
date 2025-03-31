'use server';

import { createTenantKnex } from '../../lib/db';
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

/**
 * Get all services for a plan
 */
export async function getPlanServices(planId: string): Promise<IPlanService[]> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error("tenant context not found");
  }

  const services = await knex('plan_services')
    .where({
      plan_id: planId,
      tenant
    })
    .select('*');

  return services;
}

/**
 * Get a specific service in a plan
 */
export async function getPlanService(planId: string, serviceId: string): Promise<IPlanService | null> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error("tenant context not found");
  }

  const service = await knex('plan_services')
    .where({
      plan_id: planId,
      service_id: serviceId,
      tenant
    })
    .first();

  return service || null;
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
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error("tenant context not found");
  }

  // Get service details and join with standard_service_types to get the type's billing_method
  const serviceWithType = await knex('service_catalog as sc')
    .leftJoin('standard_service_types as sst', 'sc.service_type_id', 'sst.id')
    .where({
      'sc.service_id': serviceId,
      'sc.tenant': tenant
    })
    .select('sc.*', 'sst.billing_method as service_type_billing_method') // Select the billing_method from the type table
    .first() as IService & { service_type_billing_method?: 'fixed' | 'per_unit' }; // Add type info

  if (!serviceWithType) {
    throw new Error(`Service ${serviceId} not found`);
  }
  // Use serviceWithType which includes service_type_billing_method for logic below
  const service = serviceWithType; // Keep using 'service' variable name for compatibility with validation block

  // Get plan details
  const plan = await knex('billing_plans')
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

  if (configType) {
    determinedConfigType = configType;
  } else if (serviceWithType?.service_type_billing_method === 'fixed') {
    determinedConfigType = 'Fixed';
  } else if (serviceWithType?.service_type_billing_method === 'per_unit') {
    // Use the service's specific unit_of_measure
    if (serviceWithType.unit_of_measure?.toLowerCase().includes('hour')) {
       determinedConfigType = 'Hourly';
    } else {
       determinedConfigType = 'Usage'; // Default for other per_unit types
    }
  } else {
    // Fallback or error for missing/unknown standard service type billing method
    console.warn(`Could not determine standard billing method for service type of ${serviceId}. Defaulting configuration type to 'Fixed'.`);
    // Consider service.billing_method as secondary fallback? For now, default to Fixed.
    determinedConfigType = 'Fixed';
  }

  const configurationType = determinedConfigType;

  // Create configuration
  const configId = await planServiceConfigActions.createConfiguration(
    {
      plan_id: planId,
      service_id: serviceId,
      configuration_type: configurationType,
      custom_rate: customRate,
      quantity: quantity || 1,
      tenant
    },
    typeConfig || {}
  );

  return configId;
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
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error("tenant context not found");
  }

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
}

/**
 * Remove a service from a plan
 */
export async function removeServiceFromPlan(planId: string, serviceId: string): Promise<boolean> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error("tenant context not found");
  }

  // Get configuration ID
  const config = await planServiceConfigActions.getConfigurationForService(planId, serviceId);

  // Remove configuration if it exists
  if (config) {
    await planServiceConfigActions.deleteConfiguration(config.config_id);
  }

  return true;
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
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error("tenant context not found");
  }

  // Get all configurations for the plan
  const configurations = await planServiceConfigActions.getConfigurationsForPlan(planId);

  // Get service details including service type name for each configuration
  const result = [];
  for (const config of configurations) {
    // Join service_catalog with standard_service_types to get the name
    const service = await knex('service_catalog as sc')
      .leftJoin('standard_service_types as sst', 'sc.service_type_id', 'sst.id') // Join standard types
      .leftJoin('service_types as tst', function() { // Join tenant-specific types
        this.on('sc.service_type_id', '=', 'tst.id')
            .andOn('sc.tenant', '=', 'tst.tenant_id'); // Corrected column name
      })
      .where({
        'sc.service_id': config.service_id,
        'sc.tenant': tenant
      })
      .select('sc.*', knex.raw('COALESCE(sst.name, tst.name) as service_type_name')) // Use COALESCE for name
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
      const hourlyConfigModel = new (await import('server/src/lib/models/planServiceHourlyConfig')).default(knex, tenant);
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
}
