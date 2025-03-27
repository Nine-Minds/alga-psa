'use server';

import { createTenantKnex } from 'server/src/lib/db';
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
  
  // Get service details to determine configuration type if not provided
  const service = await knex('service_catalog')
    .where({
      service_id: serviceId,
      tenant
    })
    .first() as IService;
  
  if (!service) {
    throw new Error(`Service ${serviceId} not found`);
  }
  
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
  
  // Determine configuration type
  const configurationType = configType || 
    (service.service_type_id === 'Fixed' || service.service_type_id === 'Product' || service.service_type_id === 'License' ? 'Fixed' :
     service.service_type_id === 'Time' ? 'Hourly' :
     service.service_type_id === 'Usage' ? 'Usage' : 'Fixed');
  
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
  }
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
    updates.typeConfig
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
 * Get all services in a plan with their configurations
 */
export async function getPlanServicesWithConfigurations(planId: string): Promise<{
  service: IService;
  configuration: IPlanServiceConfiguration;
  typeConfig: IPlanServiceFixedConfig | IPlanServiceHourlyConfig | IPlanServiceUsageConfig | IPlanServiceBucketConfig | null;
}[]> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error("tenant context not found");
  }
  
  // Get all configurations for the plan
  const configurations = await planServiceConfigActions.getConfigurationsForPlan(planId);
  
  // Get service details for each configuration
  const result = [];
  for (const config of configurations) {
    const service = await knex('service_catalog')
      .where({
        service_id: config.service_id,
        tenant
      })
      .first() as IService;
    
    if (!service) {
      continue;
    }
    
    const configDetails = await planServiceConfigActions.getConfigurationWithDetails(config.config_id);
    
    result.push({
      service,
      configuration: config,
      typeConfig: configDetails.typeConfig
    });
  }
  
  return result;
}
