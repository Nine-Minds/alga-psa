'use server';

import type { Knex } from 'knex';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import type {
  BillingCycleType,
  IContract,
  IContractLine,
  IContractLineService,
  IInvoiceTemplate,
  IService,
  ITaxRate,
  ITaxRegion,
  ISO8601String,
  TaxSource,
  IClientTaxSettings,
} from '@alga-psa/types';
import {
  addTaxRate,
  canClientOverrideTaxSource,
  cloneTemplateContractLine,
  createDefaultTaxSettings,
  createNextBillingCycle,
  getActiveTaxRegions,
  getClientBillingCycleAnchor,
  getClientBillingSettings,
  getClientTaxExemptStatus,
  getClientTaxSettings,
  getContracts,
  getContractLineServices,
  getContractLines,
  getDefaultInvoiceTemplate,
  getEffectiveTaxSourceForClient,
  getInvoiceTemplates,
  createService,
  updateService,
  deleteService,
  getServiceCategories,
  getServices,
  getServiceTypesForSelection,
  getTaxRates,
  previewBillingPeriodsForSchedule,
  setClientTemplate,
  updateClientBillingSchedule,
  updateClientBillingSettings,
  updateClientTaxExemptStatus,
  updateClientTaxSettings,
  type BillingCycleAnchorSettingsInput,
  type BillingCycleCreationResult,
  type ClientBillingSettings,
  type ServiceListOptions,
  type PaginatedServicesResponse,
  type UpdateClientBillingScheduleInput,
  type ClientTaxSourceInfo,
} from '@alga-psa/shared/billingClients';
import { getSessionAsync } from './authHelpers';

function requireAuthenticatedSession(session: any): void {
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }
}

export async function createDefaultTaxSettingsAsync(clientId: string): Promise<IClientTaxSettings> {
  const session = await getSessionAsync();
  requireAuthenticatedSession(session);

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('tenant context not found');
  }

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return createDefaultTaxSettings(trx, tenant, clientId);
  });
}

export async function cloneTemplateContractLineAsync(
  trx: Knex.Transaction,
  options: {
    tenant: string;
    templateContractLineId: string;
    contractLineId: string;
    templateContractId?: string | null;
    overrideRate?: number | null;
    effectiveDate?: string | null;
  }
): Promise<{ appliedCustomRate: number | null }> {
  return cloneTemplateContractLine(trx, options);
}

export async function getClientContractLineSettingsAsync(clientId: string): Promise<ClientBillingSettings | null> {
  const session = await getSessionAsync();
  requireAuthenticatedSession(session);

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('tenant context not found');
  }

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return getClientBillingSettings(trx, tenant, clientId);
  });
}

export async function updateClientContractLineSettingsAsync(
  clientId: string,
  settings: ClientBillingSettings | null
): Promise<{ success: true }> {
  const session = await getSessionAsync();
  requireAuthenticatedSession(session);

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('tenant context not found');
  }

  await withTransaction(knex, async (trx: Knex.Transaction) => {
    await updateClientBillingSettings(trx, tenant, clientId, settings);
  });

  return { success: true };
}

export async function createNextBillingCycleAsync(clientId: string, effectiveDate?: string): Promise<BillingCycleCreationResult> {
  const session = await getSessionAsync();
  requireAuthenticatedSession(session);

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('tenant context not found');
  }

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return createNextBillingCycle(trx, tenant, clientId, effectiveDate);
  });
}

export async function updateClientBillingScheduleAsync(input: UpdateClientBillingScheduleInput): Promise<{ success: true }> {
  const session = await getSessionAsync();
  requireAuthenticatedSession(session);

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('tenant context not found');
  }

  await withTransaction(knex, async (trx: Knex.Transaction) => {
    await updateClientBillingSchedule(trx, tenant, input);
  });

  return { success: true };
}

export async function getClientBillingCycleAnchorAsync(clientId: string): Promise<{
  billingCycle: BillingCycleType;
  anchor: {
    dayOfMonth: number | null;
    monthOfYear: number | null;
    dayOfWeek: number | null;
    referenceDate: ISO8601String | null;
  };
}> {
  const session = await getSessionAsync();
  requireAuthenticatedSession(session);

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('tenant context not found');
  }

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return getClientBillingCycleAnchor(trx, tenant, clientId);
  });
}

export async function previewBillingPeriodsForScheduleAsync(
  billingCycle: BillingCycleType,
  anchor: BillingCycleAnchorSettingsInput,
  options: { count?: number; referenceDate?: ISO8601String } = {}
): Promise<Array<{ periodStartDate: ISO8601String; periodEndDate: ISO8601String }>> {
  const session = await getSessionAsync();
  requireAuthenticatedSession(session);
  return previewBillingPeriodsForSchedule(billingCycle, anchor, options);
}

export async function addTaxRateAsync(taxRate: Omit<ITaxRate, 'tax_rate_id'>): Promise<ITaxRate> {
  const session = await getSessionAsync();
  requireAuthenticatedSession(session);

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('tenant context not found');
  }

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return addTaxRate(trx, tenant, taxRate);
  });
}

export async function getActiveTaxRegionsAsync(): Promise<Pick<ITaxRegion, 'region_code' | 'region_name'>[]> {
  const session = await getSessionAsync();
  requireAuthenticatedSession(session);

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('tenant context not found');
  }

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return getActiveTaxRegions(trx, tenant);
  });
}

export async function getTaxRatesAsync(): Promise<ITaxRate[]> {
  const session = await getSessionAsync();
  requireAuthenticatedSession(session);

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('tenant context not found');
  }

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return getTaxRates(trx, tenant);
  });
}

export async function getContractLinesAsync(): Promise<IContractLine[]> {
  const session = await getSessionAsync();
  requireAuthenticatedSession(session);

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('tenant context not found');
  }

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return getContractLines(trx, tenant);
  });
}

export async function getContractLineServicesAsync(contractLineId: string): Promise<IContractLineService[]> {
  const session = await getSessionAsync();
  requireAuthenticatedSession(session);

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('tenant context not found');
  }

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return getContractLineServices(trx, tenant, contractLineId);
  });
}

export async function getContractsAsync(): Promise<IContract[]> {
  const session = await getSessionAsync();
  requireAuthenticatedSession(session);

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('tenant context not found');
  }

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return getContracts(trx, tenant);
  });
}

export async function getServiceCategoriesAsync(): Promise<any[]> {
  const session = await getSessionAsync();
  requireAuthenticatedSession(session);

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('tenant context not found');
  }

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return getServiceCategories(trx, tenant);
  });
}

export async function getServicesAsync(
  page: number = 1,
  pageSize: number = 999,
  options: ServiceListOptions = {}
): Promise<PaginatedServicesResponse> {
  const session = await getSessionAsync();
  requireAuthenticatedSession(session);

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('tenant context not found');
  }

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return getServices(trx, tenant, page, pageSize, options);
  });
}

export async function createServiceAsync(service: any): Promise<IService> {
  const session = await getSessionAsync();
  requireAuthenticatedSession(session);

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('tenant context not found');
  }

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return createService(trx, tenant, service);
  });
}

export async function updateServiceAsync(serviceId: string, service: any): Promise<IService> {
  const session = await getSessionAsync();
  requireAuthenticatedSession(session);

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('tenant context not found');
  }

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return updateService(trx, tenant, serviceId, service);
  });
}

export async function deleteServiceAsync(serviceId: string): Promise<void> {
  const session = await getSessionAsync();
  requireAuthenticatedSession(session);

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('tenant context not found');
  }

  await withTransaction(knex, async (trx: Knex.Transaction) => {
    await deleteService(trx, tenant, serviceId);
  });
}

export async function getInvoiceTemplatesAsync(): Promise<IInvoiceTemplate[]> {
  const session = await getSessionAsync();
  requireAuthenticatedSession(session);

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('tenant context not found');
  }

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return getInvoiceTemplates(trx, tenant);
  });
}

export async function getDefaultTemplateAsync(): Promise<IInvoiceTemplate | null> {
  const session = await getSessionAsync();
  requireAuthenticatedSession(session);

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('tenant context not found');
  }

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return getDefaultInvoiceTemplate(trx, tenant);
  });
}

export async function setClientTemplateAsync(clientId: string, templateId: string | null): Promise<void> {
  const session = await getSessionAsync();
  requireAuthenticatedSession(session);

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('tenant context not found');
  }

  await withTransaction(knex, async (trx: Knex.Transaction) => {
    await setClientTemplate(trx, tenant, clientId, templateId);
  });
}

export async function getServiceTypesForSelectionAsync(): Promise<
  Array<{ id: string; name: string; billing_method: 'fixed' | 'hourly' | 'per_unit' | 'usage'; is_standard: boolean }>
> {
  const session = await getSessionAsync();
  requireAuthenticatedSession(session);

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('tenant context not found');
  }

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return getServiceTypesForSelection(trx, tenant);
  });
}

export async function getPlanTypeDisplayAsync(): Promise<Record<string, string>> {
  return {
    Fixed: 'Fixed',
    Hourly: 'Hourly',
    Usage: 'Usage Based',
  };
}

export async function getClientTaxSettingsAsync(clientId: string): Promise<IClientTaxSettings | null> {
  const session = await getSessionAsync();
  requireAuthenticatedSession(session);

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('tenant context not found');
  }

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return getClientTaxSettings(trx, tenant, clientId);
  });
}

export async function updateClientTaxSettingsAsync(
  clientId: string,
  taxSettings: Omit<IClientTaxSettings, 'tenant'>
): Promise<IClientTaxSettings | null> {
  const session = await getSessionAsync();
  requireAuthenticatedSession(session);

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('tenant context not found');
  }

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return updateClientTaxSettings(trx, tenant, clientId, taxSettings);
  });
}

export async function getClientTaxExemptStatusAsync(clientId: string): Promise<{ is_tax_exempt: boolean; tax_exemption_certificate?: string } | null> {
  const session = await getSessionAsync();
  requireAuthenticatedSession(session);

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('tenant context not found');
  }

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return getClientTaxExemptStatus(trx, tenant, clientId);
  });
}

export async function updateClientTaxExemptStatusAsync(
  clientId: string,
  isTaxExempt: boolean,
  taxExemptionCertificate?: string
): Promise<{ is_tax_exempt: boolean; tax_exemption_certificate?: string }> {
  const session = await getSessionAsync();
  requireAuthenticatedSession(session);

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('tenant context not found');
  }

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return updateClientTaxExemptStatus(trx, tenant, clientId, isTaxExempt, taxExemptionCertificate);
  });
}

export async function canClientOverrideTaxSourceAsync(): Promise<boolean> {
  const session = await getSessionAsync();
  requireAuthenticatedSession(session);

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('tenant context not found');
  }

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return canClientOverrideTaxSource(trx, tenant);
  });
}

export async function getEffectiveTaxSourceForClientAsync(clientId: string): Promise<ClientTaxSourceInfo> {
  const session = await getSessionAsync();
  requireAuthenticatedSession(session);

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('tenant context not found');
  }

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return getEffectiveTaxSourceForClient(trx, tenant, clientId);
  });
}
