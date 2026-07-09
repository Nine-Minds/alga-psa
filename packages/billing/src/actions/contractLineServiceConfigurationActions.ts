'use server';

import { createTenantKnex, tenantDb } from '@alga-psa/db';
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
import { hasPermission } from '@alga-psa/auth/rbac';
import { actionError, permissionError } from '@alga-psa/ui/lib/errorHandling';
import type { ActionMessageError, ActionPermissionError } from '@alga-psa/ui/lib/errorHandling';

export type ContractLineServiceConfigActionError = ActionMessageError | ActionPermissionError;

function contractLineServiceConfigActionErrorFrom(error: unknown): ContractLineServiceConfigActionError | null {
  if (error instanceof Error && error.message.startsWith('Permission denied:')) {
    return permissionError(error.message);
  }

  if (error instanceof Error) {
    if (error.message === 'System-managed default contracts are attribution-only; contract-line service configuration authoring is disabled.') {
      return actionError(error.message);
    }
    if (error.message.includes('not found')) {
      return actionError('The selected service configuration is no longer available. Please refresh and try again.');
    }
  }

  const dbError = error as { code?: string; column?: string };
  if (dbError?.code === '22P02') {
    return actionError('One of the selected service configuration values is invalid. Please refresh and try again.');
  }
  if (dbError?.code === '23502') {
    return actionError(`Missing required service configuration field${dbError.column ? `: ${dbError.column}` : ''}.`);
  }
  if (dbError?.code === '23503') {
    return actionError('The selected contract line or service no longer exists. Please refresh and try again.');
  }
  if (dbError?.code === '23505') {
    return actionError('This service configuration already exists for the selected contract line.');
  }
  if (dbError?.code === '23514') {
    return actionError('One of the service configuration values is not allowed. Please review the form and try again.');
  }

  return null;
}

async function assertContractLineIsAuthorableByLineId(
  knex: any,
  tenant: string,
  contractLineId: string,
): Promise<void> {
  const db = tenantDb(knex, tenant);
  const query = db.table('contract_lines as cl');
  db.tenantJoin(query, 'contracts as c', 'cl.contract_id', 'c.contract_id');

  const row = await query
    .where('cl.contract_line_id', contractLineId)
    .select({ is_system_managed_default: 'c.is_system_managed_default' })
    .first();

  if (row?.is_system_managed_default === true) {
    throw new Error('System-managed default contracts are attribution-only; contract-line service configuration authoring is disabled.');
  }
}

async function assertContractLineIsAuthorableByConfigId(
  knex: any,
  tenant: string,
  configId: string,
): Promise<void> {
  const db = tenantDb(knex, tenant);
  const query = db.table('contract_line_service_configuration as cfg');
  db.tenantJoin(query, 'contract_lines as cl', 'cfg.contract_line_id', 'cl.contract_line_id');
  db.tenantJoin(query, 'contracts as c', 'cl.contract_id', 'c.contract_id');

  const row = await query
    .where('cfg.config_id', configId)
    .select({ is_system_managed_default: 'c.is_system_managed_default' })
    .first();

  if (row?.is_system_managed_default === true) {
    throw new Error('System-managed default contracts are attribution-only; contract-line service configuration authoring is disabled.');
  }
}

export const getConfigurationWithDetails = withAuth(async (
  user,
  { tenant },
  configId: string
) => {
  try {
    if (!await hasPermission(user, 'billing', 'read')) {
      return permissionError('Permission denied: billing read required');
    }
    const { knex } = await createTenantKnex();
    if (!tenant) {
      throw new Error('tenant context not found');
    }
    const service = new ContractLineServiceConfigurationService(knex, tenant);
    return service.getConfigurationWithDetails(configId);
  } catch (error) {
    console.error(`Error fetching service configuration ${configId}:`, error);
    const expected = contractLineServiceConfigActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

export const getConfigurationsForPlan = withAuth(async (
  user,
  { tenant },
  contractLineId: string
) => {
  try {
    if (!await hasPermission(user, 'billing', 'read')) {
      return permissionError('Permission denied: billing read required');
    }
    const { knex } = await createTenantKnex();
    if (!tenant) {
      throw new Error('tenant context not found');
    }
    const service = new ContractLineServiceConfigurationService(knex, tenant);
    return service.getConfigurationsForPlan(contractLineId);
  } catch (error) {
    console.error(`Error fetching service configurations for contract line ${contractLineId}:`, error);
    const expected = contractLineServiceConfigActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

export const getConfigurationForService = withAuth(async (
  user,
  { tenant },
  contractLineId: string,
  serviceId: string
) => {
  try {
    if (!await hasPermission(user, 'billing', 'read')) {
      return permissionError('Permission denied: billing read required');
    }
    const { knex } = await createTenantKnex();
    if (!tenant) {
      throw new Error('tenant context not found');
    }
    const service = new ContractLineServiceConfigurationService(knex, tenant);
    return service.getConfigurationForService(contractLineId, serviceId);
  } catch (error) {
    console.error(`Error fetching service configuration for contract line ${contractLineId} and service ${serviceId}:`, error);
    const expected = contractLineServiceConfigActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

export const createConfiguration = withAuth(async (
  user,
  { tenant },
  baseConfig: Omit<IContractLineServiceConfiguration, 'config_id' | 'created_at' | 'updated_at'>,
  typeConfig: Partial<IContractLineServiceUsageConfig | IContractLineServiceBucketConfig | Record<string, unknown>>,
  rateTiers?: IContractLineServiceRateTierInput[],
  userTypeRates?: Array<Omit<IUserTypeRate, 'created_at' | 'updated_at' | 'config_id' | 'rate_id'>>
) => {
  try {
    if (!await hasPermission(user, 'billing', 'create')) {
      return permissionError('Permission denied: billing create required');
    }
    const { knex } = await createTenantKnex();
    if (!tenant) {
      throw new Error('tenant context not found');
    }
    await assertContractLineIsAuthorableByLineId(knex, tenant, baseConfig.contract_line_id);
    const service = new ContractLineServiceConfigurationService(knex, tenant);
    return service.createConfiguration(baseConfig, typeConfig, rateTiers as any, userTypeRates);
  } catch (error) {
    console.error(`Error creating service configuration for contract line ${baseConfig.contract_line_id}:`, error);
    const expected = contractLineServiceConfigActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

export const updateConfiguration = withAuth(async (
  user,
  { tenant },
  configId: string,
  baseConfig?: Partial<IContractLineServiceConfiguration>,
  typeConfig?: Partial<IContractLineServiceUsageConfig | IContractLineServiceBucketConfig | Record<string, unknown>>,
  rateTiers?: IContractLineServiceRateTierInput[]
) => {
  try {
    if (!await hasPermission(user, 'billing', 'update')) {
      return permissionError('Permission denied: billing update required');
    }
    const { knex } = await createTenantKnex();
    if (!tenant) {
      throw new Error('tenant context not found');
    }
    await assertContractLineIsAuthorableByConfigId(knex, tenant, configId);
    const service = new ContractLineServiceConfigurationService(knex, tenant);
    return service.updateConfiguration(configId, baseConfig, typeConfig, rateTiers as any);
  } catch (error) {
    console.error(`Error updating service configuration ${configId}:`, error);
    const expected = contractLineServiceConfigActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

export const deleteConfiguration = withAuth(async (
  user,
  { tenant },
  configId: string
) => {
  try {
    if (!await hasPermission(user, 'billing', 'delete')) {
      return permissionError('Permission denied: billing delete required');
    }
    const { knex } = await createTenantKnex();
    if (!tenant) {
      throw new Error('tenant context not found');
    }
    await assertContractLineIsAuthorableByConfigId(knex, tenant, configId);
    const service = new ContractLineServiceConfigurationService(knex, tenant);
    return service.deleteConfiguration(configId);
  } catch (error) {
    console.error(`Error deleting service configuration ${configId}:`, error);
    const expected = contractLineServiceConfigActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

export const upsertPlanServiceHourlyConfiguration = withAuth(async (
  user,
  { tenant },
  contractLineId: string,
  serviceId: string,
  hourlyConfigData: Partial<IContractLineServiceHourlyConfig>
) => {
  try {
    if (!await hasPermission(user, 'billing', 'create')) {
      return permissionError('Permission denied: billing create required');
    }
    const { knex } = await createTenantKnex();
    if (!tenant) {
      throw new Error('tenant context not found');
    }
    await assertContractLineIsAuthorableByLineId(knex, tenant, contractLineId);
    const service = new ContractLineServiceConfigurationService(knex, tenant);
    return service.upsertPlanServiceHourlyConfiguration(contractLineId, serviceId, hourlyConfigData);
  } catch (error) {
    console.error(`Error upserting hourly configuration for contract line ${contractLineId} and service ${serviceId}:`, error);
    const expected = contractLineServiceConfigActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

export const upsertPlanServiceBucketConfigurationAction = withAuth(async (
  user,
  { tenant },
  contractLineId: string,
  serviceId: string,
  bucketConfigData: Partial<IContractLineServiceBucketConfig>
) => {
  try {
    if (!await hasPermission(user, 'billing', 'create')) {
      return permissionError('Permission denied: billing create required');
    }
    const { knex } = await createTenantKnex();
    if (!tenant) {
      throw new Error('tenant context not found');
    }
    await assertContractLineIsAuthorableByLineId(knex, tenant, contractLineId);
    const service = new ContractLineServiceConfigurationService(knex, tenant);
    return service.upsertPlanServiceBucketConfiguration(contractLineId, serviceId, bucketConfigData);
  } catch (error) {
    console.error(`Error upserting bucket configuration for contract line ${contractLineId} and service ${serviceId}:`, error);
    const expected = contractLineServiceConfigActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
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
  try {
    if (!await hasPermission(user, 'billing', 'create')) {
      return permissionError('Permission denied: billing create required');
    }
    const { knex } = await createTenantKnex();
    if (!tenant) {
      throw new Error('tenant context not found');
    }
    await assertContractLineIsAuthorableByLineId(knex, tenant, payload.contractLineId);
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
  } catch (error) {
    console.error(`Error upserting usage configuration for contract line ${payload.contractLineId} and service ${payload.serviceId}:`, error);
    const expected = contractLineServiceConfigActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

export const upsertUserTypeRatesForConfig = withAuth(async (
  user,
  { tenant },
  configId: string,
  rates: Array<Omit<IUserTypeRate, 'rate_id' | 'config_id' | 'created_at' | 'updated_at' | 'tenant'>>
) => {
  try {
    if (!await hasPermission(user, 'billing', 'create')) {
      return permissionError('Permission denied: billing create required');
    }
    const { knex } = await createTenantKnex();
    if (!tenant) {
      throw new Error('tenant context not found');
    }
    await assertContractLineIsAuthorableByConfigId(knex, tenant, configId);
    const service = new ContractLineServiceConfigurationService(knex, tenant);
    return service.upsertUserTypeRates(configId, rates);
  } catch (error) {
    console.error(`Error upserting user type rates for service configuration ${configId}:`, error);
    const expected = contractLineServiceConfigActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

export const getConfigurationsForContractLine = getConfigurationsForPlan;
export const getContractLineConfigurationForService = getConfigurationForService;
export const upsertContractLineServiceConfiguration = upsertPlanServiceConfiguration;
export const upsertContractLineServiceHourlyConfiguration = upsertPlanServiceHourlyConfiguration;
export const upsertContractLineServiceBucketConfigurationAction = upsertPlanServiceBucketConfigurationAction;
export const upsertUserTypeRates = upsertUserTypeRatesForConfig;
