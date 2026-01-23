'use server';

import { createTenantKnex } from '@alga-psa/db';
import { ContractLineServiceConfigurationService } from '../services/contractLineServiceConfigurationService';
import {
  IContractLineServiceConfiguration,
  IContractLineServiceHourlyConfig,
  IContractLineServiceUsageConfig,
  IContractLineServiceBucketConfig,
  IContractLineServiceRateTierInput,
  IUserTypeRate
} from '@alga-psa/types';
import { getCurrentUser } from '@alga-psa/auth/getCurrentUser';

async function getService() {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('Unauthorized');
  }
  const { knex, tenant } = await createTenantKnex(currentUser.tenant);
  if (!tenant) {
    throw new Error('tenant context not found');
  }
  return { service: new ContractLineServiceConfigurationService(knex, tenant), tenant };
}

export async function getConfigurationWithDetails(configId: string) {
  const { service } = await getService();
  return service.getConfigurationWithDetails(configId);
}

export async function getConfigurationsForPlan(contractLineId: string) {
  const { service } = await getService();
  return service.getConfigurationsForPlan(contractLineId);
}

export async function getConfigurationForService(contractLineId: string, serviceId: string) {
  const { service } = await getService();
  return service.getConfigurationForService(contractLineId, serviceId);
}

export async function createConfiguration(
  baseConfig: Omit<IContractLineServiceConfiguration, 'config_id' | 'created_at' | 'updated_at'>,
  typeConfig: Partial<IContractLineServiceUsageConfig | IContractLineServiceBucketConfig | Record<string, unknown>>,
  rateTiers?: IContractLineServiceRateTierInput[],
  userTypeRates?: Array<Omit<IUserTypeRate, 'created_at' | 'updated_at' | 'config_id' | 'rate_id'>>
) {
  const { service } = await getService();
  return service.createConfiguration(baseConfig, typeConfig, rateTiers as any, userTypeRates);
}

export async function updateConfiguration(
  configId: string,
  baseConfig?: Partial<IContractLineServiceConfiguration>,
  typeConfig?: Partial<IContractLineServiceUsageConfig | IContractLineServiceBucketConfig | Record<string, unknown>>,
  rateTiers?: IContractLineServiceRateTierInput[]
) {
  const { service } = await getService();
  return service.updateConfiguration(configId, baseConfig, typeConfig, rateTiers as any);
}

export async function deleteConfiguration(configId: string) {
  const { service } = await getService();
  return service.deleteConfiguration(configId);
}

export async function upsertPlanServiceHourlyConfiguration(
  contractLineId: string,
  serviceId: string,
  hourlyConfigData: Partial<IContractLineServiceHourlyConfig>
) {
  const { service } = await getService();
  return service.upsertPlanServiceHourlyConfiguration(contractLineId, serviceId, hourlyConfigData);
}

export async function upsertPlanServiceBucketConfigurationAction(
  contractLineId: string,
  serviceId: string,
  bucketConfigData: Partial<IContractLineServiceBucketConfig>
) {
  const { service } = await getService();
  return service.upsertPlanServiceBucketConfiguration(contractLineId, serviceId, bucketConfigData);
}

type UsageConfigPayload = {
  contractLineId: string;
  serviceId: string;
  base_rate?: number;
  unit_of_measure?: string;
  minimum_usage?: number;
  enable_tiered_pricing?: boolean;
  tiers?: Array<{ min_quantity: number; max_quantity?: number; rate: number }>;
};

export async function upsertPlanServiceConfiguration(payload: UsageConfigPayload) {
  const { service, tenant } = await getService();
  const existing = await service.getConfigurationForService(payload.contractLineId, payload.serviceId);

  const usageConfig: Partial<IContractLineServiceUsageConfig> = {
    unit_of_measure: payload.unit_of_measure ?? 'Unit',
    enable_tiered_pricing: payload.enable_tiered_pricing ?? false,
    minimum_usage: payload.minimum_usage ?? undefined,
    base_rate: payload.base_rate ?? undefined
  };

  const rateTiers: IContractLineServiceRateTierInput[] | undefined = payload.enable_tiered_pricing
    ? (payload.tiers || []).map(tier => ({
        min_quantity: tier.min_quantity,
        max_quantity: tier.max_quantity,
        rate: tier.rate
      }))
    : undefined;

  if (existing) {
    await service.updateConfiguration(existing.config_id, undefined, usageConfig, rateTiers as any);
    return existing.config_id;
  }

  const baseConfig: Omit<IContractLineServiceConfiguration, 'config_id' | 'created_at' | 'updated_at'> = {
    contract_line_id: payload.contractLineId,
    service_id: payload.serviceId,
    configuration_type: 'Usage',
    custom_rate: undefined,
    quantity: undefined,
    instance_name: undefined,
    tenant
  };

  return service.createConfiguration(baseConfig, usageConfig, rateTiers as any);
}

export async function upsertUserTypeRatesForConfig(
  configId: string,
  rates: Array<Omit<IUserTypeRate, 'rate_id' | 'config_id' | 'created_at' | 'updated_at' | 'tenant'>>
) {
  const { service } = await getService();
  return service.upsertUserTypeRates(configId, rates);
}

export const getConfigurationsForContractLine = getConfigurationsForPlan;
export const getContractLineConfigurationForService = getConfigurationForService;
export const upsertContractLineServiceConfiguration = upsertPlanServiceConfiguration;
export const upsertContractLineServiceHourlyConfiguration = upsertPlanServiceHourlyConfiguration;
export const upsertContractLineServiceBucketConfigurationAction = upsertPlanServiceBucketConfigurationAction;
export const upsertUserTypeRates = upsertUserTypeRatesForConfig;
