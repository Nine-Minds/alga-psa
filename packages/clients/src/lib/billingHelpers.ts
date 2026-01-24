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
import { withAuth, withAuthCheck } from '@alga-psa/auth';

export const createDefaultTaxSettingsAsync = withAuth(async (
  _user,
  { tenant },
  clientId: string
): Promise<IClientTaxSettings> => {
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return createDefaultTaxSettings(trx, tenant, clientId);
  });
});

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

export const getClientContractLineSettingsAsync = withAuth(async (
  _user,
  { tenant },
  clientId: string
): Promise<ClientBillingSettings | null> => {
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return getClientBillingSettings(trx, tenant, clientId);
  });
});

export const updateClientContractLineSettingsAsync = withAuth(async (
  _user,
  { tenant },
  clientId: string,
  settings: ClientBillingSettings | null
): Promise<{ success: true }> => {
  const { knex } = await createTenantKnex();

  await withTransaction(knex, async (trx: Knex.Transaction) => {
    await updateClientBillingSettings(trx, tenant, clientId, settings);
  });

  return { success: true };
});

export const createNextBillingCycleAsync = withAuth(async (
  _user,
  { tenant },
  clientId: string,
  effectiveDate?: string
): Promise<BillingCycleCreationResult> => {
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return createNextBillingCycle(trx, tenant, clientId, effectiveDate);
  });
});

export const updateClientBillingScheduleAsync = withAuth(async (
  _user,
  { tenant },
  input: UpdateClientBillingScheduleInput
): Promise<{ success: true }> => {
  const { knex } = await createTenantKnex();

  await withTransaction(knex, async (trx: Knex.Transaction) => {
    await updateClientBillingSchedule(trx, tenant, input);
  });

  return { success: true };
});

export const getClientBillingCycleAnchorAsync = withAuth(async (
  _user,
  { tenant },
  clientId: string
): Promise<{
  billingCycle: BillingCycleType;
  anchor: {
    dayOfMonth: number | null;
    monthOfYear: number | null;
    dayOfWeek: number | null;
    referenceDate: ISO8601String | null;
  };
}> => {
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return getClientBillingCycleAnchor(trx, tenant, clientId);
  });
});

export const previewBillingPeriodsForScheduleAsync = withAuthCheck(async (
  _user,
  billingCycle: BillingCycleType,
  anchor: BillingCycleAnchorSettingsInput,
  options: { count?: number; referenceDate?: ISO8601String } = {}
): Promise<Array<{ periodStartDate: ISO8601String; periodEndDate: ISO8601String }>> => {
  return previewBillingPeriodsForSchedule(billingCycle, anchor, options);
});

export const addTaxRateAsync = withAuth(async (
  _user,
  { tenant },
  taxRate: Omit<ITaxRate, 'tax_rate_id'>
): Promise<ITaxRate> => {
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return addTaxRate(trx, tenant, taxRate);
  });
});

export const getActiveTaxRegionsAsync = withAuth(async (
  _user,
  { tenant }
): Promise<Pick<ITaxRegion, 'region_code' | 'region_name'>[]> => {
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return getActiveTaxRegions(trx, tenant);
  });
});

export const getTaxRatesAsync = withAuth(async (
  _user,
  { tenant }
): Promise<ITaxRate[]> => {
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return getTaxRates(trx, tenant);
  });
});

export const getContractLinesAsync = withAuth(async (
  _user,
  { tenant }
): Promise<IContractLine[]> => {
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return getContractLines(trx, tenant);
  });
});

export const getContractLineServicesAsync = withAuth(async (
  _user,
  { tenant },
  contractLineId: string
): Promise<IContractLineService[]> => {
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return getContractLineServices(trx, tenant, contractLineId);
  });
});

export const getContractsAsync = withAuth(async (
  _user,
  { tenant }
): Promise<IContract[]> => {
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return getContracts(trx, tenant);
  });
});

export const getServiceCategoriesAsync = withAuth(async (
  _user,
  { tenant }
): Promise<any[]> => {
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return getServiceCategories(trx, tenant);
  });
});

export const getServicesAsync = withAuth(async (
  _user,
  { tenant },
  page: number = 1,
  pageSize: number = 999,
  options: ServiceListOptions = {}
): Promise<PaginatedServicesResponse> => {
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return getServices(trx, tenant, page, pageSize, options);
  });
});

export const createServiceAsync = withAuth(async (
  _user,
  { tenant },
  service: any
): Promise<IService> => {
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return createService(trx, tenant, service);
  });
});

export const updateServiceAsync = withAuth(async (
  _user,
  { tenant },
  serviceId: string,
  service: any
): Promise<IService> => {
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return updateService(trx, tenant, serviceId, service);
  });
});

export const deleteServiceAsync = withAuth(async (
  _user,
  { tenant },
  serviceId: string
): Promise<void> => {
  const { knex } = await createTenantKnex();

  await withTransaction(knex, async (trx: Knex.Transaction) => {
    await deleteService(trx, tenant, serviceId);
  });
});

export const getInvoiceTemplatesAsync = withAuth(async (
  _user,
  { tenant }
): Promise<IInvoiceTemplate[]> => {
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return getInvoiceTemplates(trx, tenant);
  });
});

export const getDefaultTemplateAsync = withAuth(async (
  _user,
  { tenant }
): Promise<IInvoiceTemplate | null> => {
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return getDefaultInvoiceTemplate(trx, tenant);
  });
});

export const setClientTemplateAsync = withAuth(async (
  _user,
  { tenant },
  clientId: string,
  templateId: string | null
): Promise<void> => {
  const { knex } = await createTenantKnex();

  await withTransaction(knex, async (trx: Knex.Transaction) => {
    await setClientTemplate(trx, tenant, clientId, templateId);
  });
});

export const getServiceTypesForSelectionAsync = withAuth(async (
  _user,
  { tenant }
): Promise<
  Array<{ id: string; name: string; billing_method: 'fixed' | 'hourly' | 'per_unit' | 'usage'; is_standard: boolean }>
> => {
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return getServiceTypesForSelection(trx, tenant);
  });
});

export const getPlanTypeDisplayAsync = withAuthCheck(async (
  _user
): Promise<Record<string, string>> => {
  return {
    Fixed: 'Fixed',
    Hourly: 'Hourly',
    Usage: 'Usage Based',
  };
});

export const getClientTaxSettingsAsync = withAuth(async (
  _user,
  { tenant },
  clientId: string
): Promise<IClientTaxSettings | null> => {
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return getClientTaxSettings(trx, tenant, clientId);
  });
});

export const updateClientTaxSettingsAsync = withAuth(async (
  _user,
  { tenant },
  clientId: string,
  taxSettings: Omit<IClientTaxSettings, 'tenant'>
): Promise<IClientTaxSettings | null> => {
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return updateClientTaxSettings(trx, tenant, clientId, taxSettings);
  });
});

export const getClientTaxExemptStatusAsync = withAuth(async (
  _user,
  { tenant },
  clientId: string
): Promise<{ is_tax_exempt: boolean; tax_exemption_certificate?: string } | null> => {
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return getClientTaxExemptStatus(trx, tenant, clientId);
  });
});

export const updateClientTaxExemptStatusAsync = withAuth(async (
  _user,
  { tenant },
  clientId: string,
  isTaxExempt: boolean,
  taxExemptionCertificate?: string
): Promise<{ is_tax_exempt: boolean; tax_exemption_certificate?: string }> => {
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return updateClientTaxExemptStatus(trx, tenant, clientId, isTaxExempt, taxExemptionCertificate);
  });
});

export const canClientOverrideTaxSourceAsync = withAuth(async (
  _user,
  { tenant }
): Promise<boolean> => {
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return canClientOverrideTaxSource(trx, tenant);
  });
});

export const getEffectiveTaxSourceForClientAsync = withAuth(async (
  _user,
  { tenant },
  clientId: string
): Promise<ClientTaxSourceInfo> => {
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return getEffectiveTaxSourceForClient(trx, tenant, clientId);
  });
});
