'use server';

import {
  createConfiguration as createConfigurationImpl,
  deleteConfiguration as deleteConfigurationImpl,
  getConfigurationForService as getConfigurationForServiceImpl,
  getConfigurationWithDetails as getConfigurationWithDetailsImpl,
  getConfigurationsForPlan as getConfigurationsForPlanImpl,
  updateConfiguration as updateConfigurationImpl,
  upsertPlanServiceBucketConfigurationAction as upsertPlanServiceBucketConfigurationActionImpl,
  upsertPlanServiceConfiguration as upsertPlanServiceConfigurationImpl,
  upsertPlanServiceHourlyConfiguration as upsertPlanServiceHourlyConfigurationImpl,
  upsertUserTypeRatesForConfig as upsertUserTypeRatesForConfigImpl,
} from '@alga-psa/billing/actions/contractLineServiceConfigurationActions';

export async function getConfigurationWithDetails(
  ...args: Parameters<typeof getConfigurationWithDetailsImpl>
): ReturnType<typeof getConfigurationWithDetailsImpl> {
  return getConfigurationWithDetailsImpl(...args);
}

export async function getConfigurationsForPlan(
  ...args: Parameters<typeof getConfigurationsForPlanImpl>
): ReturnType<typeof getConfigurationsForPlanImpl> {
  return getConfigurationsForPlanImpl(...args);
}

export async function getConfigurationForService(
  ...args: Parameters<typeof getConfigurationForServiceImpl>
): ReturnType<typeof getConfigurationForServiceImpl> {
  return getConfigurationForServiceImpl(...args);
}

export async function createConfiguration(
  ...args: Parameters<typeof createConfigurationImpl>
): ReturnType<typeof createConfigurationImpl> {
  return createConfigurationImpl(...args);
}

export async function updateConfiguration(
  ...args: Parameters<typeof updateConfigurationImpl>
): ReturnType<typeof updateConfigurationImpl> {
  return updateConfigurationImpl(...args);
}

export async function deleteConfiguration(
  ...args: Parameters<typeof deleteConfigurationImpl>
): ReturnType<typeof deleteConfigurationImpl> {
  return deleteConfigurationImpl(...args);
}

export async function upsertPlanServiceHourlyConfiguration(
  ...args: Parameters<typeof upsertPlanServiceHourlyConfigurationImpl>
): ReturnType<typeof upsertPlanServiceHourlyConfigurationImpl> {
  return upsertPlanServiceHourlyConfigurationImpl(...args);
}

export async function upsertPlanServiceBucketConfigurationAction(
  ...args: Parameters<typeof upsertPlanServiceBucketConfigurationActionImpl>
): ReturnType<typeof upsertPlanServiceBucketConfigurationActionImpl> {
  return upsertPlanServiceBucketConfigurationActionImpl(...args);
}

export async function upsertPlanServiceConfiguration(
  ...args: Parameters<typeof upsertPlanServiceConfigurationImpl>
): ReturnType<typeof upsertPlanServiceConfigurationImpl> {
  return upsertPlanServiceConfigurationImpl(...args);
}

export async function upsertUserTypeRatesForConfig(
  ...args: Parameters<typeof upsertUserTypeRatesForConfigImpl>
): ReturnType<typeof upsertUserTypeRatesForConfigImpl> {
  return upsertUserTypeRatesForConfigImpl(...args);
}

export const getConfigurationsForContractLine = getConfigurationsForPlan;
export const getContractLineConfigurationForService = getConfigurationForService;
export const upsertContractLineServiceConfiguration = upsertPlanServiceConfiguration;
export const upsertContractLineServiceHourlyConfiguration = upsertPlanServiceHourlyConfiguration;
export const upsertContractLineServiceBucketConfigurationAction = upsertPlanServiceBucketConfigurationAction;
export const upsertUserTypeRates = upsertUserTypeRatesForConfig;

