'use server';

import { createTenantKnex } from 'server/src/lib/db';
import {
  IPlanServiceConfiguration,
  IPlanServiceFixedConfig,
  IPlanServiceHourlyConfig,
  IPlanServiceUsageConfig,
  IPlanServiceBucketConfig,
  IPlanServiceRateTier, // Import the rate tier interface
  IUserTypeRate
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