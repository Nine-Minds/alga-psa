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
import { withAuth } from '@alga-psa/auth';

export const getConfigurationWithDetails = withAuth(async (
  user,
  { tenant },
  configId: string
) => {
  const { knex } = await createTenantKnex();
  if (!tenant) {
    throw new Error('tenant context not found');
  }
  const service = new ContractLineServiceConfigurationService(knex, tenant);
  return service.getConfigurationWithDetails(configId);
});

export const getConfigurationsForPlan = withAuth(async (
  user,
  { tenant },
  contractLineId: string
) => {
  const { knex } = await createTenantKnex();
  if (!tenant) {
    throw new Error('tenant context not found');
  }
  const service = new ContractLineServiceConfigurationService(knex, tenant);
  return service.getConfigurationsForPlan(contractLineId);
});

export const getConfigurationForService = withAuth(async (
  user,
  { tenant },
  contractLineId: string,
  serviceId: string
) => {
  const { knex } = await createTenantKnex();
  if (!tenant) {
    throw new Error('tenant context not found');
  }
  const service = new ContractLineServiceConfigurationService(knex, tenant);
  return service.getConfigurationForService(contractLineId, serviceId);
});

export const createConfiguration = withAuth(async (
  user,
  { tenant },
  baseConfig: Omit<IContractLineServiceConfiguration, 'config_id' | 'created_at' | 'updated_at'>,
  typeConfig: Partial<IContractLineServiceUsageConfig | IContractLineServiceBucketConfig | Record<string, unknown>>,
  rateTiers?: IContractLineServiceRateTierInput[],
  userTypeRates?: Array<Omit<IUserTypeRate, 'created_at' | 'updated_at' | 'config_id' | 'rate_id'>>
) => {
  const { knex } = await createTenantKnex();
  if (!tenant) {
    throw new Error('tenant context not found');
  }
  const service = new ContractLineServiceConfigurationService(knex, tenant);
  return service.createConfiguration(baseConfig, typeConfig, rateTiers as any, userTypeRates);
});

export const updateConfiguration = withAuth(async (
  user,
  { tenant },
  configId: string,
  baseConfig?: Partial<IContractLineServiceConfiguration>,
  typeConfig?: Partial<IContractLineServiceUsageConfig | IContractLineServiceBucketConfig | Record<string, unknown>>,
  rateTiers?: IContractLineServiceRateTierInput[]
) => {
  const { knex } = await createTenantKnex();
  if (!tenant) {
    throw new Error('tenant context not found');
  }
  const service = new ContractLineServiceConfigurationService(knex, tenant);
  return service.updateConfiguration(configId, baseConfig, typeConfig, rateTiers as any);
});

export const deleteConfiguration = withAuth(async (
  user,
  { tenant },
  configId: string
) => {
  const { knex } = await createTenantKnex();
  if (!tenant) {
    throw new Error('tenant context not found');
  }
  const service = new ContractLineServiceConfigurationService(knex, tenant);
  return service.deleteConfiguration(configId);
});

export const upsertPlanServiceHourlyConfiguration = withAuth(async (
  user,
  { tenant },
  contractLineId: string,
  serviceId: string,
  hourlyConfigData: Partial<IContractLineServiceHourlyConfig>
) => {
  const { knex } = await createTenantKnex();
  if (!tenant) {
    throw new Error('tenant context not found');
  }
  const service = new ContractLineServiceConfigurationService(knex, tenant);
  return service.upsertPlanServiceHourlyConfiguration(contractLineId, serviceId, hourlyConfigData);
});

export const upsertPlanServiceBucketConfigurationAction = withAuth(async (
  user,
  { tenant },
  contractLineId: string,
  serviceId: string,
  bucketConfigData: Partial<IContractLineServiceBucketConfig>
) => {
  const { knex } = await createTenantKnex();
  if (!tenant) {
    throw new Error('tenant context not found');
  }
  const service = new ContractLineServiceConfigurationService(knex, tenant);
  return service.upsertPlanServiceBucketConfiguration(contractLineId, serviceId, bucketConfigData);
});

type UsageConfigPayload = {
  contractLineId: string;
  serviceId: string;
  base_rate?: number;
  unit_of_measure?: string;
  minimum_usage?: number;
  enable_tiered_pricing?: boolean;
  tiers?: Array<{ min_quantity: number; max_quantity?: number; rate: number }>;
};

export const upsertPlanServiceConfiguration = withAuth(async (
  user,
  { tenant },
  payload: UsageConfigPayload
) => {
  const { knex } = await createTenantKnex();
  if (!tenant) {
    throw new Error('tenant context not found');
  }
  const service = new ContractLineServiceConfigurationService(knex, tenant);
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
});

export const upsertUserTypeRatesForConfig = withAuth(async (
  user,
  { tenant },
  configId: string,
  rates: Array<Omit<IUserTypeRate, 'rate_id' | 'config_id' | 'created_at' | 'updated_at' | 'tenant'>>
) => {
  const { knex } = await createTenantKnex();
  if (!tenant) {
    throw new Error('tenant context not found');
  }
  const service = new ContractLineServiceConfigurationService(knex, tenant);
  return service.upsertUserTypeRates(configId, rates);
});

export const getConfigurationsForContractLine = getConfigurationsForPlan;
export const getContractLineConfigurationForService = getConfigurationForService;
export const upsertContractLineServiceConfiguration = upsertPlanServiceConfiguration;
export const upsertContractLineServiceHourlyConfiguration = upsertPlanServiceHourlyConfiguration;
export const upsertContractLineServiceBucketConfigurationAction = upsertPlanServiceBucketConfigurationAction;
export const upsertUserTypeRates = upsertUserTypeRatesForConfig;
