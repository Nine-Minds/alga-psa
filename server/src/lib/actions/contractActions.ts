'use server';

import {
  addContractLine as addContractLineImpl,
  checkClientHasActiveContract as checkClientHasActiveContractImpl,
  checkContractHasInvoices as checkContractHasInvoicesImpl,
  createContract as createContractImpl,
  deleteContract as deleteContractImpl,
  getContractAssignments as getContractAssignmentsImpl,
  getContractById as getContractByIdImpl,
  getContractLineMappings as getContractLineMappingsImpl,
  getContractLinesForContract as getContractLinesForContractImpl,
  getContractOverview as getContractOverviewImpl,
  getContractSummary as getContractSummaryImpl,
  getContractTemplates as getContractTemplatesImpl,
  getContracts as getContractsImpl,
  getContractsWithClients as getContractsWithClientsImpl,
  getDetailedContractLines as getDetailedContractLinesImpl,
  isContractLineAttached as isContractLineAttachedImpl,
  removeContractLine as removeContractLineImpl,
  updateContract as updateContractImpl,
  updateContractLineAssociation as updateContractLineAssociationImpl,
  updateContractLineRate as updateContractLineRateImpl,
} from '@alga-psa/billing/actions/contractActions';

export async function getContracts(...args: Parameters<typeof getContractsImpl>): ReturnType<typeof getContractsImpl> {
  return getContractsImpl(...args);
}

export async function getContractTemplates(
  ...args: Parameters<typeof getContractTemplatesImpl>
): ReturnType<typeof getContractTemplatesImpl> {
  return getContractTemplatesImpl(...args);
}

export async function getContractsWithClients(
  ...args: Parameters<typeof getContractsWithClientsImpl>
): ReturnType<typeof getContractsWithClientsImpl> {
  return getContractsWithClientsImpl(...args);
}

export async function getContractById(
  ...args: Parameters<typeof getContractByIdImpl>
): ReturnType<typeof getContractByIdImpl> {
  return getContractByIdImpl(...args);
}

export async function getContractLineMappings(
  ...args: Parameters<typeof getContractLineMappingsImpl>
): ReturnType<typeof getContractLineMappingsImpl> {
  return getContractLineMappingsImpl(...args);
}

export async function getDetailedContractLines(
  ...args: Parameters<typeof getDetailedContractLinesImpl>
): ReturnType<typeof getDetailedContractLinesImpl> {
  return getDetailedContractLinesImpl(...args);
}

export async function addContractLine(
  ...args: Parameters<typeof addContractLineImpl>
): ReturnType<typeof addContractLineImpl> {
  return addContractLineImpl(...args);
}

export async function removeContractLine(
  ...args: Parameters<typeof removeContractLineImpl>
): ReturnType<typeof removeContractLineImpl> {
  return removeContractLineImpl(...args);
}

export async function updateContractLineAssociation(
  ...args: Parameters<typeof updateContractLineAssociationImpl>
): ReturnType<typeof updateContractLineAssociationImpl> {
  return updateContractLineAssociationImpl(...args);
}

export async function updateContractLineRate(
  ...args: Parameters<typeof updateContractLineRateImpl>
): ReturnType<typeof updateContractLineRateImpl> {
  return updateContractLineRateImpl(...args);
}

export async function isContractLineAttached(
  ...args: Parameters<typeof isContractLineAttachedImpl>
): ReturnType<typeof isContractLineAttachedImpl> {
  return isContractLineAttachedImpl(...args);
}

export async function createContract(
  ...args: Parameters<typeof createContractImpl>
): ReturnType<typeof createContractImpl> {
  return createContractImpl(...args);
}

export async function updateContract(
  ...args: Parameters<typeof updateContractImpl>
): ReturnType<typeof updateContractImpl> {
  return updateContractImpl(...args);
}

export async function checkContractHasInvoices(
  ...args: Parameters<typeof checkContractHasInvoicesImpl>
): ReturnType<typeof checkContractHasInvoicesImpl> {
  return checkContractHasInvoicesImpl(...args);
}

export async function deleteContract(
  ...args: Parameters<typeof deleteContractImpl>
): ReturnType<typeof deleteContractImpl> {
  return deleteContractImpl(...args);
}

export async function getContractLinesForContract(
  ...args: Parameters<typeof getContractLinesForContractImpl>
): ReturnType<typeof getContractLinesForContractImpl> {
  return getContractLinesForContractImpl(...args);
}

export async function getContractSummary(
  ...args: Parameters<typeof getContractSummaryImpl>
): ReturnType<typeof getContractSummaryImpl> {
  return getContractSummaryImpl(...args);
}

export async function checkClientHasActiveContract(
  ...args: Parameters<typeof checkClientHasActiveContractImpl>
): ReturnType<typeof checkClientHasActiveContractImpl> {
  return checkClientHasActiveContractImpl(...args);
}

export async function getContractAssignments(
  ...args: Parameters<typeof getContractAssignmentsImpl>
): ReturnType<typeof getContractAssignmentsImpl> {
  return getContractAssignmentsImpl(...args);
}

export async function getContractOverview(
  ...args: Parameters<typeof getContractOverviewImpl>
): ReturnType<typeof getContractOverviewImpl> {
  return getContractOverviewImpl(...args);
}
