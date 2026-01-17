'use server';

import {
  createContractLine as createContractLineImpl,
  deleteContractLine as deleteContractLineImpl,
  getCombinedFixedPlanConfiguration as getCombinedFixedPlanConfigurationImpl,
  getContractLineById as getContractLineByIdImpl,
  getContractLineFixedConfig as getContractLineFixedConfigImpl,
  getContractLines as getContractLinesImpl,
  updateContractLine as updateContractLineImpl,
  updateContractLineFixedConfig as updateContractLineFixedConfigImpl,
  updatePlanServiceFixedConfigRate as updatePlanServiceFixedConfigRateImpl,
  upsertContractLineTerms as upsertContractLineTermsImpl,
} from '@alga-psa/billing/actions/contractLineAction';

export async function getContractLines(
  ...args: Parameters<typeof getContractLinesImpl>
): ReturnType<typeof getContractLinesImpl> {
  return getContractLinesImpl(...args);
}

export async function getContractLineById(
  ...args: Parameters<typeof getContractLineByIdImpl>
): ReturnType<typeof getContractLineByIdImpl> {
  return getContractLineByIdImpl(...args);
}

export async function createContractLine(
  ...args: Parameters<typeof createContractLineImpl>
): ReturnType<typeof createContractLineImpl> {
  return createContractLineImpl(...args);
}

export async function updateContractLine(
  ...args: Parameters<typeof updateContractLineImpl>
): ReturnType<typeof updateContractLineImpl> {
  return updateContractLineImpl(...args);
}

export async function upsertContractLineTerms(
  ...args: Parameters<typeof upsertContractLineTermsImpl>
): ReturnType<typeof upsertContractLineTermsImpl> {
  return upsertContractLineTermsImpl(...args);
}

export async function deleteContractLine(
  ...args: Parameters<typeof deleteContractLineImpl>
): ReturnType<typeof deleteContractLineImpl> {
  return deleteContractLineImpl(...args);
}

export async function getCombinedFixedPlanConfiguration(
  ...args: Parameters<typeof getCombinedFixedPlanConfigurationImpl>
): ReturnType<typeof getCombinedFixedPlanConfigurationImpl> {
  return getCombinedFixedPlanConfigurationImpl(...args);
}

export async function getContractLineFixedConfig(
  ...args: Parameters<typeof getContractLineFixedConfigImpl>
): ReturnType<typeof getContractLineFixedConfigImpl> {
  return getContractLineFixedConfigImpl(...args);
}

export async function updateContractLineFixedConfig(
  ...args: Parameters<typeof updateContractLineFixedConfigImpl>
): ReturnType<typeof updateContractLineFixedConfigImpl> {
  return updateContractLineFixedConfigImpl(...args);
}

export async function updatePlanServiceFixedConfigRate(
  ...args: Parameters<typeof updatePlanServiceFixedConfigRateImpl>
): ReturnType<typeof updatePlanServiceFixedConfigRateImpl> {
  return updatePlanServiceFixedConfigRateImpl(...args);
}
