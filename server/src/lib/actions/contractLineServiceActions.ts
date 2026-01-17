'use server';

import {
  addServiceToContractLine as addServiceToContractLineImpl,
  getContractLineService as getContractLineServiceImpl,
  getContractLineServices as getContractLineServicesImpl,
  getContractLineServicesWithConfigurations as getContractLineServicesWithConfigurationsImpl,
  getContractLineServicesWithNames as getContractLineServicesWithNamesImpl,
  getTemplateLineServicesWithConfigurations as getTemplateLineServicesWithConfigurationsImpl,
  removeServiceFromContractLine as removeServiceFromContractLineImpl,
  updateContractLineService as updateContractLineServiceImpl,
} from '@alga-psa/billing/actions/contractLineServiceActions';

export async function getContractLineServices(
  ...args: Parameters<typeof getContractLineServicesImpl>
): ReturnType<typeof getContractLineServicesImpl> {
  return getContractLineServicesImpl(...args);
}

export async function getContractLineServicesWithNames(
  ...args: Parameters<typeof getContractLineServicesWithNamesImpl>
): ReturnType<typeof getContractLineServicesWithNamesImpl> {
  return getContractLineServicesWithNamesImpl(...args);
}

export async function getContractLineService(
  ...args: Parameters<typeof getContractLineServiceImpl>
): ReturnType<typeof getContractLineServiceImpl> {
  return getContractLineServiceImpl(...args);
}

export async function addServiceToContractLine(
  ...args: Parameters<typeof addServiceToContractLineImpl>
): ReturnType<typeof addServiceToContractLineImpl> {
  return addServiceToContractLineImpl(...args);
}

export async function updateContractLineService(
  ...args: Parameters<typeof updateContractLineServiceImpl>
): ReturnType<typeof updateContractLineServiceImpl> {
  return updateContractLineServiceImpl(...args);
}

export async function removeServiceFromContractLine(
  ...args: Parameters<typeof removeServiceFromContractLineImpl>
): ReturnType<typeof removeServiceFromContractLineImpl> {
  return removeServiceFromContractLineImpl(...args);
}

export async function getContractLineServicesWithConfigurations(
  ...args: Parameters<typeof getContractLineServicesWithConfigurationsImpl>
): ReturnType<typeof getContractLineServicesWithConfigurationsImpl> {
  return getContractLineServicesWithConfigurationsImpl(...args);
}

export async function getTemplateLineServicesWithConfigurations(
  ...args: Parameters<typeof getTemplateLineServicesWithConfigurationsImpl>
): ReturnType<typeof getTemplateLineServicesWithConfigurationsImpl> {
  return getTemplateLineServicesWithConfigurationsImpl(...args);
}
