import { v4 as uuidv4 } from 'uuid';
import type { TestContext } from './testContext';

interface SetupTaxOptions {
  regionCode?: string;
  regionName?: string;
  taxPercentage?: number;
  startDate?: string;
  description?: string;
  clientId?: string;
}

interface AssignServiceTaxRateOptions {
  onlyUnset?: boolean;
}

let clientTaxSettingsColumnsCache: Record<string, unknown> | null | undefined;
let clientTaxRatesColumnsCache: Record<string, unknown> | null | undefined;
const serviceTypeCache = new Map<string, string>();
const debugFlags = {
  createServiceLogCount: 0
};

/**
 * Clears the service type cache. Useful when tests reset their context/tenant
 * and need to ensure stale service type IDs aren't reused.
 */
export function clearServiceTypeCache(): void {
  serviceTypeCache.clear();
}

interface BillingSettingsOptions {
  zeroDollarInvoiceHandling?: 'normal' | 'finalized';
  suppressZeroDollarInvoices?: boolean;
  enableCreditExpiration?: boolean;
  creditExpirationDays?: number;
  creditExpirationNotificationDays?: number[];
}

export async function setupClientTaxConfiguration(
  context: TestContext,
  options: SetupTaxOptions = {}
): Promise<string> {
  const {
    regionCode = 'US-NY',
    regionName = 'Default Region',
    taxPercentage,
    startDate = '2025-01-01T00:00:00.000Z',
    description = `${regionCode} Tax`
  } = options;

  const targetClientId = options.clientId ?? context.clientId;

  const existingActiveRate = await context.db('tax_rates')
    .where({ tenant: context.tenantId, region_code: regionCode, is_active: true })
    .orderBy('start_date', 'desc')
    .first();

  const shouldCreateNewRate = typeof taxPercentage === 'number';

  const taxRateId = shouldCreateNewRate ? uuidv4() : existingActiveRate?.tax_rate_id ?? uuidv4();

  if (shouldCreateNewRate) {
    // Deactivate any existing tax rates for this region within the tenant so the new rate becomes authoritative
    await context.db('tax_rates')
      .where({ tenant: context.tenantId, region_code: regionCode })
      .update({ is_active: false });
  }

  await context.db('tax_regions')
    .insert({
      tenant: context.tenantId,
      region_code: regionCode,
      region_name: regionName,
      is_active: true
    })
    .onConflict(['tenant', 'region_code'])
    .ignore();

  if (shouldCreateNewRate || !existingActiveRate) {
    try {
      await context.db('tax_rates')
        .insert({
          tax_rate_id: taxRateId,
          tenant: context.tenantId,
          region_code: regionCode,
          tax_percentage: shouldCreateNewRate
            ? taxPercentage
            : existingActiveRate?.tax_percentage ?? 8.875,
          description,
          start_date: startDate,
          is_active: true
        });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('duplicate') && !(error as { code?: string }).code?.includes('23505')) {
        throw error;
      }
    }
  }

  await upsertClientTaxSettings(context, taxRateId, targetClientId);
  await upsertClientDefaultTaxRate(context, taxRateId, targetClientId);
  await assignServiceTaxRate(context, '*', regionCode, { onlyUnset: true });

  return taxRateId;
}

export async function assignServiceTaxRate(
  context: TestContext,
  serviceId: string | '*',
  region: string,
  options: AssignServiceTaxRateOptions = {}
): Promise<void> {
  const taxRate = await context.db('tax_rates')
    .where({ tenant: context.tenantId, region_code: region })
    .orderBy('start_date', 'desc')
    .first();

  if (!taxRate) {
    return;
  }

  const query = context.db('service_catalog')
    .where({ tenant: context.tenantId });

  if (serviceId !== '*') {
    query.andWhere({ service_id: serviceId });
  }

  if (options.onlyUnset) {
    query.whereNull('tax_rate_id');
  }

  await query.update({ tax_rate_id: taxRate.tax_rate_id });
}

async function upsertClientTaxSettings(
  context: TestContext,
  taxRateId: string,
  clientId: string
): Promise<void> {
  try {
    if (clientTaxSettingsColumnsCache === undefined) {
      clientTaxSettingsColumnsCache = await context.db('client_tax_settings').columnInfo();
    }
  } catch (error) {
    clientTaxSettingsColumnsCache = null;
  }

  if (!clientTaxSettingsColumnsCache || Object.keys(clientTaxSettingsColumnsCache).length === 0) {
    return;
  }

  const clientExists = await context.db('clients')
    .where({ tenant: context.tenantId, client_id: clientId })
    .first();

  if (!clientExists) {
    return;
  }

  const baseData: Record<string, unknown> = {
    tenant: context.tenantId,
    client_id: clientId,
    is_reverse_charge_applicable: false
  };

  if ('tax_rate_id' in clientTaxSettingsColumnsCache) {
    baseData.tax_rate_id = taxRateId;
  }

  await context.db('client_tax_settings')
    .insert(baseData)
    .onConflict(['tenant', 'client_id'])
    .merge(baseData);
}

async function upsertClientDefaultTaxRate(
  context: TestContext,
  taxRateId: string,
  clientId: string
): Promise<void> {
  try {
    if (clientTaxRatesColumnsCache === undefined) {
      clientTaxRatesColumnsCache = await context.db('client_tax_rates').columnInfo();
    }
  } catch (error) {
    clientTaxRatesColumnsCache = null;
  }

  if (!clientTaxRatesColumnsCache || Object.keys(clientTaxRatesColumnsCache).length === 0) {
    return;
  }

  const clientExists = await context.db('clients')
    .where({ tenant: context.tenantId, client_id: clientId })
    .first();

  if (!clientExists) {
    return;
  }

  if ('is_default' in clientTaxRatesColumnsCache) {
    await context.db('client_tax_rates')
      .where({ tenant: context.tenantId, client_id: clientId })
      .update({ is_default: false });
  }

  const rateData: Record<string, unknown> = {
    tenant: context.tenantId,
    client_id: clientId,
    tax_rate_id: taxRateId
  };

  if ('is_default' in clientTaxRatesColumnsCache) {
    rateData.is_default = true;
  }

  if ('location_id' in clientTaxRatesColumnsCache) {
    rateData.location_id = null;
  }

  const existingRate = await context.db('client_tax_rates')
    .where({
      tenant: context.tenantId,
      client_id: clientId,
      tax_rate_id: taxRateId
    })
    .first();

  if (existingRate) {
    await context.db('client_tax_rates')
      .where({
        tenant: context.tenantId,
        client_tax_rates_id: existingRate.client_tax_rates_id
      })
      .update({
        ...rateData,
        updated_at: context.db.fn.now()
      });
  } else {
    await context.db('client_tax_rates').insert({
      ...rateData,
      created_at: context.db.fn.now(),
      updated_at: context.db.fn.now()
    });
  }
}

interface CreateServiceOptions {
  service_id?: string;
  service_name?: string;
  billing_method?: 'fixed' | 'hourly' | 'usage' | 'time';
  default_rate?: number;
  unit_of_measure?: string;
  description?: string | null;
  category_id?: string | null;
  custom_service_type_id?: string;
  tax_region?: string;
  tax_rate_id?: string | null;
}

interface CreateFixedPlanOptions {
  planId?: string;
  clientBillingPlanId?: string;
  planName?: string;
  billingFrequency?: 'monthly' | 'annual';
  baseRateCents?: number;
  detailBaseRateCents?: number;
  quantity?: number;
  startDate?: string;
  endDate?: string | null;
  billingTiming?: 'arrears' | 'advance';
  enableProration?: boolean;
  billingCycleAlignment?: 'start' | 'end' | 'prorated';
  clientId?: string;
}

interface AddServiceToPlanOptions {
  quantity?: number;
  detailBaseRateCents?: number;
}

interface CreateBucketOverlayOptions {
  configId?: string;
  serviceId?: string;
  totalMinutes?: number;
  totalHours?: number;
  overageRateCents?: number;
  allowRollover?: boolean;
  billingPeriod?: string;
}

interface CreateBucketUsageOptions {
  usageId?: string;
  planId?: string;
  contractLineId?: string;
  serviceId: string;
  clientId: string;
  periodStart: string;
  periodEnd: string;
  minutesUsed: number;
  overageMinutes?: number;
  rolledOverMinutes?: number;
}

async function ensureServiceType(
  context: TestContext,
  billingMethod: 'fixed' | 'hourly' | 'usage' = 'fixed'
): Promise<string> {
  const cacheKey = `${context.tenantId}:${billingMethod}`;
  if (serviceTypeCache.has(cacheKey)) {
    return serviceTypeCache.get(cacheKey)!;
  }

  const columns = await context.db('service_types').columnInfo();
  const tenantColumn = columns.tenant ? 'tenant' : columns.tenant_id ? 'tenant_id' : null;

  if (!tenantColumn) {
    throw new Error('Unable to determine tenant column for service_types table');
  }

  const existingType = await context.db('service_types')
    .where({ [tenantColumn]: context.tenantId, billing_method: billingMethod })
    .first('id');

  if (existingType?.id) {
    serviceTypeCache.set(cacheKey, existingType.id);
    return existingType.id;
  }

  const typeId = uuidv4();
  const typeData: Record<string, unknown> = {
    id: typeId,
    name:
      billingMethod === 'fixed'
        ? 'Fixed Service Type'
        : billingMethod === 'hourly'
          ? 'Hourly Service Type'
          : 'Usage Service Type',
    billing_method: billingMethod,
    is_active: true,
    description: 'Auto-generated service type for invoice tests',
    [tenantColumn]: context.tenantId
  };

  // Leave order_number null to avoid collisions with unique constraints in legacy schemas.

  await context.db('service_types').insert(typeData);
  if (process.env.DEBUG_SERVICE_TYPES === 'true' && debugFlags.createServiceLogCount < 5) {
    const row = await context.db('service_types').where({ id: typeId }).first();
    console.log('Inserted service_type row', row);
  }
  serviceTypeCache.set(cacheKey, typeId);
  return typeId;
}

async function getStandardServiceTypeId(
  context: TestContext,
  billingMethod: 'fixed' | 'hourly' | 'usage'
): Promise<string | null> {
  const hasTable = await context.db.schema.hasTable('standard_service_types');
  if (!hasTable) {
    return null;
  }

  try {
    const columns = await context.db('standard_service_types').columnInfo();
    const tenantColumn = columns.tenant ? 'tenant' : columns.tenant_id ? 'tenant_id' : null;

    let query = context.db('standard_service_types').where({ billing_method: billingMethod });
    if (tenantColumn) {
      query = query.andWhere(tenantColumn, context.tenantId);
    }

    const record = await query.first('id');
    if (record?.id) {
      return record.id as string;
    }

    const fallback = await context.db('standard_service_types').first('id');
    return (fallback?.id as string) ?? null;
  } catch {
    return null;
  }
}

export async function createTestService(
  context: TestContext,
  overrides: CreateServiceOptions = {}
): Promise<string> {
  const serviceId = overrides.service_id ?? uuidv4();
  const billingMethod = overrides.billing_method ?? 'fixed';
  const normalizedBillingMethod = billingMethod === 'time' ? 'hourly' : billingMethod;
  const cacheKey = `${context.tenantId}:${normalizedBillingMethod}`;
  let serviceTypeId: string | null = overrides.custom_service_type_id ?? null;

  if (!serviceTypeId) {
    try {
      serviceTypeId = await ensureServiceType(context, normalizedBillingMethod);
    } catch (error) {
      // If service types aren't available in this schema iteration, fall back to null.
      serviceTypeId = null;
    }
  }

  const serviceCatalogColumns = await context.db('service_catalog').columnInfo();

  const hasCustomServiceTypeColumn = 'custom_service_type_id' in serviceCatalogColumns;
  const hasStandardServiceTypeColumn = 'standard_service_type_id' in serviceCatalogColumns;

  let resolvedCustomServiceTypeId: string | null = serviceTypeId;
  if (hasCustomServiceTypeColumn && resolvedCustomServiceTypeId) {
    const typeExists = await context.db('service_types')
      .where({ id: resolvedCustomServiceTypeId })
      .first('id')
      .catch(() => null);

    if (!typeExists) {
      serviceTypeCache.delete(cacheKey);
      resolvedCustomServiceTypeId = await ensureServiceType(context, normalizedBillingMethod);
    }
  }

  let resolvedStandardServiceTypeId: string | null = null;
  if (hasStandardServiceTypeColumn) {
    resolvedStandardServiceTypeId = await getStandardServiceTypeId(context, normalizedBillingMethod);
  }

  if (process.env.DEBUG_SERVICE_TYPES === 'true' && debugFlags.createServiceLogCount < 5) {
    const hasServiceTypesTable = await context.db.schema.hasTable('service_types');
    const serviceTypesColumns = hasServiceTypesTable ? await context.db('service_types').columnInfo() : null;
    const hasStandardTable = await context.db.schema.hasTable('standard_service_types');
    const standardColumns = hasStandardTable ? await context.db('standard_service_types').columnInfo() : null;
    console.log('service_catalog columns', serviceCatalogColumns);
    console.log('service_types columns', serviceTypesColumns);
    console.log('standard_service_types columns', standardColumns);
    console.log('resolved custom serviceTypeId', resolvedCustomServiceTypeId);
    console.log('resolved standard serviceTypeId', resolvedStandardServiceTypeId);
    debugFlags.createServiceLogCount += 1;
  }

  const serviceData: Record<string, unknown> = {
    service_id: serviceId,
    tenant: context.tenantId,
    service_name: overrides.service_name ?? 'Test Service',
    billing_method: normalizedBillingMethod,
    default_rate: overrides.default_rate ?? 1000,
    unit_of_measure: overrides.unit_of_measure ?? 'each',
    description: overrides.description ?? 'Test Service Description',
    category_id: overrides.category_id ?? null,
    tax_rate_id: overrides.tax_rate_id ?? null
  };

  if (hasCustomServiceTypeColumn) {
    serviceData.custom_service_type_id = resolvedCustomServiceTypeId;
  }

  if (hasStandardServiceTypeColumn) {
    serviceData.standard_service_type_id = resolvedStandardServiceTypeId;
  }

  await context.db('service_catalog').insert(serviceData);

  if (overrides.tax_region) {
    await assignServiceTaxRate(context, serviceId, overrides.tax_region);
  }

  return serviceId;
}

export async function createFixedPlanAssignment(
  context: TestContext,
  serviceId: string,
  options: CreateFixedPlanOptions = {}
): Promise<{ planId: string; clientBillingPlanId: string; contractLineId: string; clientContractLineId: string }> {
  const contractLineId = options.planId ?? uuidv4();
  const clientContractLineId = options.clientBillingPlanId ?? uuidv4();
  const legacyPlanId = contractLineId;
  const legacyClientPlanId = clientContractLineId;
  const configId = uuidv4();
  const baseRateCents = options.baseRateCents ?? 1000;
  const baseRateDollars = baseRateCents / 100;
  const detailBaseRateCents = options.detailBaseRateCents ?? baseRateCents;
  const detailBaseRateDollars = detailBaseRateCents / 100;
  const enableProration = options.enableProration ?? false;
  const billingCycleAlignment: 'start' | 'end' | 'prorated' = options.billingCycleAlignment ?? 'start';
  const quantity = options.quantity ?? 1;
  const planName = options.planName ?? 'Test Plan';
  const billingFrequency = options.billingFrequency ?? 'monthly';
  const targetClientId = options.clientId ?? context.clientId;
  const billingTiming: 'arrears' | 'advance' = options.billingTiming ?? 'arrears';

  // Primary contract line tables
  await context.db('contract_lines')
    .insert({
      contract_line_id: contractLineId,
      tenant: context.tenantId,
      contract_line_name: planName,
      billing_frequency: billingFrequency,
      is_custom: false,
      contract_line_type: 'Fixed',
      custom_rate: baseRateDollars,
      enable_proration: enableProration,
      billing_cycle_alignment: billingCycleAlignment,
      billing_timing: billingTiming
    })
    .onConflict(['tenant', 'contract_line_id'])
    .merge({
      contract_line_name: planName,
      billing_frequency: billingFrequency,
      contract_line_type: 'Fixed',
      custom_rate: baseRateDollars,
      enable_proration: enableProration,
      billing_cycle_alignment: billingCycleAlignment,
      billing_timing: billingTiming
    });

  await context.db('contract_line_service_configuration')
    .insert({
      config_id: configId,
      contract_line_id: contractLineId,
      service_id: serviceId,
      configuration_type: 'Fixed',
      custom_rate: null,
      quantity,
      tenant: context.tenantId
    })
    .onConflict(['tenant', 'config_id'])
    .merge({
      contract_line_id: contractLineId,
      service_id: serviceId,
      configuration_type: 'Fixed',
      custom_rate: null,
      quantity
    });

  await context.db('contract_line_service_fixed_config')
    .insert({
      config_id: configId,
      tenant: context.tenantId,
      base_rate: baseRateDollars
    })
    .onConflict(['tenant', 'config_id'])
    .merge({ base_rate: baseRateDollars });

  await context.db('contract_line_services')
    .insert({
      tenant: context.tenantId,
      contract_line_id: contractLineId,
      service_id: serviceId,
      quantity,
      custom_rate: null
    })
    .onConflict(['tenant', 'service_id', 'contract_line_id'])
    .merge({ quantity, custom_rate: null });

  await context.db('client_contract_lines')
    .insert({
      tenant: context.tenantId,
      client_contract_line_id: clientContractLineId,
      client_id: targetClientId,
      contract_line_id: contractLineId,
      start_date: options.startDate ?? '2025-02-01',
      end_date: options.endDate ?? null,
      is_active: true
    })
    .onConflict(['tenant', 'client_contract_line_id'])
    .merge({
      client_id: targetClientId,
      contract_line_id: contractLineId,
      start_date: options.startDate ?? '2025-02-01',
      end_date: options.endDate ?? null,
      is_active: true
    });

  const legacyPlanTablesExist = await context.db.schema.hasTable('billing_plans');

  if (legacyPlanTablesExist) {
    await context.db('billing_plans')
      .insert({
        plan_id: legacyPlanId,
        tenant: context.tenantId,
        plan_name: planName,
        billing_frequency: billingFrequency,
        is_custom: false,
        plan_type: 'Fixed'
      })
      .onConflict(['tenant', 'plan_id'])
      .merge({
        plan_name: planName,
        billing_frequency: billingFrequency,
        plan_type: 'Fixed'
      });

    await context.db('billing_plan_fixed_config')
      .insert({
        plan_id: legacyPlanId,
        tenant: context.tenantId,
        base_rate: baseRateDollars,
        enable_proration: enableProration,
        billing_cycle_alignment: billingCycleAlignment
      })
      .onConflict(['tenant', 'plan_id'])
      .merge({
        base_rate: baseRateDollars,
        enable_proration: enableProration,
        billing_cycle_alignment: billingCycleAlignment
      });

    await context.db('plan_service_configuration')
      .insert({
        config_id: configId,
        plan_id: legacyPlanId,
        service_id: serviceId,
        configuration_type: 'Fixed',
        custom_rate: null,
        quantity,
        tenant: context.tenantId
      })
      .onConflict(['tenant', 'config_id'])
      .merge({
        plan_id: legacyPlanId,
        service_id: serviceId,
        configuration_type: 'Fixed',
        custom_rate: null,
        quantity
      });

    await context.db('plan_service_fixed_config')
      .insert({
        config_id: configId,
        tenant: context.tenantId,
        base_rate: detailBaseRateDollars
      })
      .onConflict(['tenant', 'config_id'])
      .merge({ base_rate: detailBaseRateDollars });

    await context.db('plan_services')
      .insert({
        tenant: context.tenantId,
        plan_id: legacyPlanId,
        service_id: serviceId,
        quantity,
        custom_rate: null
      })
      .onConflict(['tenant', 'service_id', 'plan_id'])
      .merge({ quantity, custom_rate: null });

    await context.db('client_billing_plans')
      .insert({
        tenant: context.tenantId,
        client_billing_plan_id: legacyClientPlanId,
        client_id: targetClientId,
        plan_id: legacyPlanId,
        service_category: null,
        is_active: true,
        start_date: options.startDate ?? '2025-02-01',
        end_date: options.endDate ?? null,
        client_bundle_id: null
      })
      .onConflict(['tenant', 'client_billing_plan_id'])
      .merge({
        client_id: targetClientId,
        plan_id: legacyPlanId,
        is_active: true,
        start_date: options.startDate ?? '2025-02-01',
        end_date: options.endDate ?? null
      });
  }

  const now = context.db.fn.now();
  const effectiveDate = `${options.startDate ?? '2025-02-01'}T00:00:00Z`;
  const customRateDollars = options.customRateCents !== undefined
    ? options.customRateCents / 100
    : null;

  let existingClientService = await context.db('client_contract_services')
    .where({
      tenant: context.tenantId,
      client_contract_line_id: clientContractLineId,
      service_id: serviceId
    })
    .first<{ client_contract_service_id: string }>('client_contract_service_id');

  const clientContractServiceId = existingClientService?.client_contract_service_id ?? uuidv4();

  if (existingClientService) {
    await context.db('client_contract_services')
      .where({
        tenant: context.tenantId,
        client_contract_service_id: clientContractServiceId
      })
      .update({
        quantity,
        custom_rate: customRateDollars,
        updated_at: now
      });
  } else {
    await context.db('client_contract_services').insert({
      tenant: context.tenantId,
      client_contract_service_id: clientContractServiceId,
      client_contract_line_id: clientContractLineId,
      service_id: serviceId,
      quantity,
      custom_rate: customRateDollars,
      effective_date: effectiveDate,
      created_at: now,
      updated_at: now
    });
  }

  let existingClientConfig = await context.db('client_contract_service_configuration')
    .where({
      tenant: context.tenantId,
      client_contract_service_id: clientContractServiceId
    })
    .first<{ config_id: string }>('config_id');

  const clientConfigId = existingClientConfig?.config_id ?? uuidv4();

  if (existingClientConfig) {
    await context.db('client_contract_service_configuration')
      .where({
        tenant: context.tenantId,
        config_id: clientConfigId
      })
      .update({
        configuration_type: 'Fixed',
        custom_rate: customRateDollars,
        quantity,
        updated_at: now
      });
  } else {
    await context.db('client_contract_service_configuration').insert({
      tenant: context.tenantId,
      config_id: clientConfigId,
      client_contract_service_id: clientContractServiceId,
      configuration_type: 'Fixed',
      custom_rate: customRateDollars,
      quantity,
      created_at: now,
      updated_at: now
    });
  }

  await context.db('client_contract_service_fixed_config')
    .insert({
      tenant: context.tenantId,
      config_id: clientConfigId,
      base_rate: baseRateDollars,
      enable_proration: enableProration,
      billing_cycle_alignment: billingCycleAlignment,
      created_at: now,
      updated_at: now
    })
    .onConflict(['tenant', 'config_id'])
    .merge({
      base_rate: baseRateDollars,
      enable_proration: enableProration,
      billing_cycle_alignment: billingCycleAlignment,
      updated_at: now
    });

  return {
    planId: legacyPlanId,
    clientBillingPlanId: legacyClientPlanId,
    contractLineId,
    clientContractLineId
  };
}

export async function ensureClientPlanBundlesTable(context: TestContext): Promise<void> {
  await context.db.raw(`
    CREATE TABLE IF NOT EXISTS client_plan_bundles (
      bundle_id UUID PRIMARY KEY,
      client_id UUID NOT NULL,
      tenant UUID NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      start_date TIMESTAMPTZ NOT NULL,
      end_date TIMESTAMPTZ,
      po_required BOOLEAN NOT NULL DEFAULT FALSE,
      po_number TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

export async function ensureDefaultBillingSettings(
  context: TestContext,
  options: BillingSettingsOptions = {}
): Promise<void> {
  const {
    zeroDollarInvoiceHandling = 'normal',
    suppressZeroDollarInvoices = false,
    enableCreditExpiration = false,
    creditExpirationDays = 365,
    creditExpirationNotificationDays = [30, 7, 1]
  } = options;

  const notificationArraySql = `ARRAY[${creditExpirationNotificationDays.map(() => '?').join(',')}]::INTEGER[]`;

  const hasDefaultSettingsTable = await context.db.schema.hasTable('default_billing_settings');
  if (hasDefaultSettingsTable) {
    await context.db('default_billing_settings')
      .insert({
        tenant: context.tenantId,
        zero_dollar_invoice_handling: zeroDollarInvoiceHandling,
        suppress_zero_dollar_invoices: suppressZeroDollarInvoices,
        enable_credit_expiration: enableCreditExpiration,
        credit_expiration_days: creditExpirationDays,
        credit_expiration_notification_days: context.db.raw(notificationArraySql, creditExpirationNotificationDays),
        created_at: context.db.fn.now(),
        updated_at: context.db.fn.now()
      })
      .onConflict('tenant')
      .merge({
        zero_dollar_invoice_handling: zeroDollarInvoiceHandling,
        suppress_zero_dollar_invoices: suppressZeroDollarInvoices,
        enable_credit_expiration: enableCreditExpiration,
        credit_expiration_days: creditExpirationDays,
        credit_expiration_notification_days: context.db.raw(notificationArraySql, creditExpirationNotificationDays),
        updated_at: context.db.fn.now()
      });
  }

  const hasCompanySettingsTable = await context.db.schema.hasTable('company_billing_settings');
  if (hasCompanySettingsTable) {
    await context.db('company_billing_settings')
      .insert({
        tenant: context.tenantId,
        company_id: context.clientId,
        zero_dollar_invoice_handling: zeroDollarInvoiceHandling,
        suppress_zero_dollar_invoices: suppressZeroDollarInvoices,
        enable_credit_expiration: enableCreditExpiration,
        credit_expiration_days: creditExpirationDays,
        credit_expiration_notification_days: context.db.raw(notificationArraySql, creditExpirationNotificationDays),
        created_at: context.db.fn.now(),
        updated_at: context.db.fn.now()
      })
      .onConflict(['tenant', 'company_id'])
      .merge({
        zero_dollar_invoice_handling: zeroDollarInvoiceHandling,
        suppress_zero_dollar_invoices: suppressZeroDollarInvoices,
        enable_credit_expiration: enableCreditExpiration,
        credit_expiration_days: creditExpirationDays,
        credit_expiration_notification_days: context.db.raw(notificationArraySql, creditExpirationNotificationDays),
        updated_at: context.db.fn.now()
      });
  }
}

export async function addServiceToFixedPlan(
  context: TestContext,
  planId: string,
  serviceId: string,
  options: AddServiceToPlanOptions = {}
): Promise<string> {
  const configId = uuidv4();
  const quantity = options.quantity ?? 1;
  const detailBaseRateCents = options.detailBaseRateCents ?? 0;
  const detailBaseRateDollars = detailBaseRateCents / 100;

  // Insert into new contract line tables
  await context.db('contract_line_service_configuration')
    .insert({
      config_id: configId,
      contract_line_id: planId,
      service_id: serviceId,
      configuration_type: 'Fixed',
      custom_rate: null,
      quantity,
      tenant: context.tenantId
    });

  await context.db('contract_line_service_fixed_config')
    .insert({
      config_id: configId,
      tenant: context.tenantId,
      base_rate: detailBaseRateDollars
    });

  await context.db('contract_line_services')
    .insert({
      tenant: context.tenantId,
      contract_line_id: planId,
      service_id: serviceId,
      quantity,
      custom_rate: null
    })
    .onConflict(['tenant', 'service_id', 'contract_line_id'])
    .merge({ quantity, custom_rate: null });

  const planServiceConfigExists = await context.db.schema.hasTable('plan_service_configuration');
  const planServiceFixedExists = await context.db.schema.hasTable('plan_service_fixed_config');
  const planServicesExists = await context.db.schema.hasTable('plan_services');

  if (planServiceConfigExists && planServiceFixedExists && planServicesExists) {
    // Insert into legacy plan tables for compatibility
    await context.db('plan_service_configuration')
      .insert({
        config_id: configId,
        plan_id: planId,
        service_id: serviceId,
        configuration_type: 'Fixed',
        custom_rate: null,
        quantity,
        tenant: context.tenantId
      });

    await context.db('plan_service_fixed_config')
      .insert({
        config_id: configId,
        tenant: context.tenantId,
        base_rate: detailBaseRateDollars
      });

    await context.db('plan_services')
      .insert({
        tenant: context.tenantId,
        plan_id: planId,
        service_id: serviceId,
        quantity,
        custom_rate: null
      })
      .onConflict(['tenant', 'service_id', 'plan_id'])
      .merge({ quantity, custom_rate: null });
  }

  return configId;
}

let planBucketConfigColumnsCache: Record<string, unknown> | null | undefined;
let contractLineBucketConfigColumnsCache: Record<string, unknown> | null | undefined;
let bucketUsageColumnsCache: Record<string, unknown> | null | undefined;
let clientContractBucketConfigColumnsCache: Record<string, unknown> | null | undefined;

async function ensurePlanBucketConfigColumns(context: TestContext): Promise<Record<string, unknown> | null> {
  if (planBucketConfigColumnsCache === undefined) {
    const tableExists = await context.db.schema.hasTable('plan_service_bucket_config');

    if (!tableExists) {
      planBucketConfigColumnsCache = null;
    } else {
      try {
        planBucketConfigColumnsCache = await context.db('plan_service_bucket_config').columnInfo();
      } catch (error) {
        planBucketConfigColumnsCache = null;
      }
    }
  }

  return planBucketConfigColumnsCache ?? null;
}

async function ensureContractLineBucketConfigColumns(context: TestContext): Promise<Record<string, unknown> | null> {
  if (contractLineBucketConfigColumnsCache === undefined) {
    try {
      contractLineBucketConfigColumnsCache = await context.db('contract_line_service_bucket_config').columnInfo();
    } catch (error) {
      contractLineBucketConfigColumnsCache = null;
    }
  }

  return contractLineBucketConfigColumnsCache ?? null;
}

async function ensureBucketUsageColumns(context: TestContext): Promise<Record<string, unknown> | null> {
  if (bucketUsageColumnsCache === undefined) {
    try {
      bucketUsageColumnsCache = await context.db('bucket_usage').columnInfo();
    } catch (error) {
      bucketUsageColumnsCache = null;
    }
  }

  return bucketUsageColumnsCache ?? null;
}

async function ensureClientContractBucketConfigColumns(context: TestContext): Promise<Record<string, unknown> | null> {
  if (clientContractBucketConfigColumnsCache === undefined) {
    try {
      clientContractBucketConfigColumnsCache = await context.db('client_contract_service_bucket_config').columnInfo();
    } catch (error) {
      clientContractBucketConfigColumnsCache = null;
    }
  }

  return clientContractBucketConfigColumnsCache ?? null;
}

export async function createBucketOverlayForPlan(
  context: TestContext,
  planId: string,
  options: CreateBucketOverlayOptions = {}
): Promise<{ configId: string; serviceId: string }> {
  const totalMinutes = options.totalMinutes ?? Math.round((options.totalHours ?? 40) * 60);
  const overageRateCents = options.overageRateCents ?? 0;
  const allowRollover = options.allowRollover ?? false;
  const billingPeriod = options.billingPeriod ?? 'monthly';

  // Identify the service this overlay should attach to, defaulting to the fixed configuration for the plan.
  let serviceId = options.serviceId;
  let quantity: number | null = null;
  let customRate: number | null = null;

  let contractBaseConfig;

  if (serviceId) {
    contractBaseConfig = await context.db('contract_line_service_configuration')
      .where({
        tenant: context.tenantId,
        contract_line_id: planId,
        service_id: serviceId
      })
      .whereNot('configuration_type', 'Bucket')
      .first();
  } else {
    contractBaseConfig = await context.db('contract_line_service_configuration')
      .where({
        tenant: context.tenantId,
        contract_line_id: planId
      })
      .whereNot('configuration_type', 'Bucket')
      .orderBy('created_at', 'asc')
      .first();

    if (contractBaseConfig) {
      serviceId = contractBaseConfig.service_id;
    }
  }

  if (contractBaseConfig) {
    quantity = contractBaseConfig.quantity ?? null;
    customRate = contractBaseConfig.custom_rate ?? null;
  }

  let planBaseConfig;
  if (!serviceId) {
    planBaseConfig = await context.db('plan_service_configuration')
      .where({
        tenant: context.tenantId,
        plan_id: planId
      })
      .whereNot('configuration_type', 'Bucket')
      .orderBy('created_at', 'asc')
      .first();

    if (planBaseConfig) {
      serviceId = planBaseConfig.service_id;
      quantity = planBaseConfig.quantity ?? quantity;
      customRate = planBaseConfig.custom_rate ?? customRate;
    }
  } else if (!contractBaseConfig) {
    planBaseConfig = await context.db('plan_service_configuration')
      .where({
        tenant: context.tenantId,
        plan_id: planId,
        service_id: serviceId
      })
      .whereNot('configuration_type', 'Bucket')
      .first();

    if (planBaseConfig) {
      quantity = planBaseConfig.quantity ?? quantity;
      customRate = planBaseConfig.custom_rate ?? customRate;
    }
  }

  if (!serviceId) {
    throw new Error(`Unable to determine service for bucket overlay on plan ${planId}`);
  }

  // Reuse existing overlay config if one exists so tests can update settings idempotently.
  const existingOverlayConfig = await context.db('contract_line_service_configuration')
    .where({
      tenant: context.tenantId,
      contract_line_id: planId,
      service_id: serviceId,
      configuration_type: 'Bucket'
    })
    .first();

  const configId = options.configId ?? existingOverlayConfig?.config_id ?? uuidv4();

  await context.db('contract_line_services')
    .insert({
      tenant: context.tenantId,
      contract_line_id: planId,
      service_id: serviceId,
      quantity,
      custom_rate: customRate
    })
    .onConflict(['tenant', 'service_id', 'contract_line_id'])
    .merge({ quantity, custom_rate: customRate });

  await context.db('contract_line_service_configuration')
    .insert({
      config_id: configId,
      contract_line_id: planId,
      service_id: serviceId,
      configuration_type: 'Bucket',
      custom_rate: null,
      quantity: null,
      tenant: context.tenantId
    })
    .onConflict(['tenant', 'config_id'])
    .merge({
      contract_line_id: planId,
      service_id: serviceId,
      configuration_type: 'Bucket'
    });

  const contractBucketColumns = await ensureContractLineBucketConfigColumns(context);
  if (!contractBucketColumns) {
    throw new Error('contract_line_service_bucket_config table is unavailable');
  }

  const contractTotalMinutesColumn = contractBucketColumns.total_minutes
    ? 'total_minutes'
    : contractBucketColumns.total_hours
      ? 'total_hours'
      : null;

  if (!contractTotalMinutesColumn) {
    throw new Error('Unable to determine total minutes column for contract bucket config');
  }

  const contractBucketData: Record<string, unknown> = {
    config_id: configId,
    tenant: context.tenantId,
    billing_period: billingPeriod,
    overage_rate: overageRateCents,
    allow_rollover: allowRollover
  };

  if (contractTotalMinutesColumn === 'total_minutes') {
    contractBucketData.total_minutes = totalMinutes;
  } else {
    contractBucketData.total_hours = Math.round(totalMinutes / 60);
  }

  const contractBucketUpdate: Record<string, unknown> = {
    billing_period: contractBucketData.billing_period,
    overage_rate: contractBucketData.overage_rate,
    allow_rollover: contractBucketData.allow_rollover,
  };

  if (contractTotalMinutesColumn === 'total_minutes') {
    contractBucketUpdate.total_minutes = contractBucketData.total_minutes;
  } else {
    contractBucketUpdate.total_hours = contractBucketData.total_hours;
  }

  await context.db('contract_line_service_bucket_config')
    .insert(contractBucketData)
    .onConflict(['tenant', 'config_id'])
    .merge(contractBucketUpdate);

  const planServicesTableExists = await context.db.schema.hasTable('plan_services');

  if (planServicesTableExists) {
    const planServiceConfigExists = await context.db.schema.hasTable('plan_service_configuration');
    const planServiceBucketExists = await context.db.schema.hasTable('plan_service_bucket_config');

    if (planServiceConfigExists && planServiceBucketExists) {
      await context.db('plan_services')
        .insert({
          tenant: context.tenantId,
          plan_id: planId,
          service_id: serviceId,
          quantity,
          custom_rate: customRate
        })
        .onConflict(['tenant', 'service_id', 'plan_id'])
        .merge({ quantity, custom_rate: customRate });

      // Maintain legacy plan_service_* tables so tests remain compatible during the transition.
      await context.db('plan_service_configuration')
        .insert({
          config_id: configId,
          plan_id: planId,
          service_id: serviceId,
          configuration_type: 'Bucket',
          custom_rate: null,
          quantity: null,
          tenant: context.tenantId
        })
        .onConflict(['tenant', 'config_id'])
        .merge({
          plan_id: planId,
          service_id: serviceId,
          configuration_type: 'Bucket'
        });

      const planBucketColumns = await ensurePlanBucketConfigColumns(context);

      if (planBucketColumns) {
        const planTotalMinutesColumn = planBucketColumns.total_minutes
          ? 'total_minutes'
          : planBucketColumns.total_hours
            ? 'total_hours'
            : null;

        if (planTotalMinutesColumn) {
          const planBucketData: Record<string, unknown> = {
            config_id: configId,
            tenant: context.tenantId,
            billing_period: billingPeriod,
            overage_rate: overageRateCents,
            allow_rollover: allowRollover
          };

          if (planTotalMinutesColumn === 'total_minutes') {
            planBucketData.total_minutes = totalMinutes;
          } else {
            planBucketData.total_hours = Math.round(totalMinutes / 60);
          }

          const planBucketUpdate: Record<string, unknown> = {
            billing_period: planBucketData.billing_period,
            overage_rate: planBucketData.overage_rate,
            allow_rollover: planBucketData.allow_rollover,
          };

          if (planTotalMinutesColumn === 'total_minutes') {
            planBucketUpdate.total_minutes = planBucketData.total_minutes;
          } else {
            planBucketUpdate.total_hours = planBucketData.total_hours;
          }

          await context.db('plan_service_bucket_config')
            .insert(planBucketData)
            .onConflict(['tenant', 'config_id'])
            .merge(planBucketUpdate);
        }
      }
    }
  }

  const clientServices = await context.db('client_contract_services as ccs')
    .join('client_contract_lines as ccl', function () {
      this.on('ccs.client_contract_line_id', '=', 'ccl.client_contract_line_id')
        .andOn('ccs.tenant', '=', 'ccl.tenant');
    })
    .where({
      'ccl.contract_line_id': planId,
      'ccs.service_id': serviceId,
      'ccs.tenant': context.tenantId
    })
    .select('ccs.client_contract_service_id');

  if (clientServices.length > 0) {
    const clientBucketColumns = await ensureClientContractBucketConfigColumns(context);
    const now = context.db.fn.now();

    for (const clientService of clientServices) {
      const existingClientBucketConfig = await context.db('client_contract_service_configuration')
        .where({
          tenant: context.tenantId,
          client_contract_service_id: clientService.client_contract_service_id,
          configuration_type: 'Bucket'
        })
        .first<{ config_id: string }>('config_id');

      const clientConfigId = existingClientBucketConfig?.config_id ?? uuidv4();

      if (existingClientBucketConfig) {
        await context.db('client_contract_service_configuration')
          .where({
            tenant: context.tenantId,
            config_id: clientConfigId
          })
          .update({
            configuration_type: 'Bucket',
            custom_rate: null,
            quantity: null,
            updated_at: now
          });
      } else {
        await context.db('client_contract_service_configuration').insert({
          tenant: context.tenantId,
          config_id: clientConfigId,
          client_contract_service_id: clientService.client_contract_service_id,
          configuration_type: 'Bucket',
          custom_rate: null,
          quantity: null,
          created_at: now,
          updated_at: now
        });
      }

      if (clientBucketColumns) {
        const clientBucketData: Record<string, unknown> = {
          tenant: context.tenantId,
          config_id: clientConfigId,
          billing_period: billingPeriod,
          overage_rate: overageRateCents,
          allow_rollover: allowRollover,
          created_at: now,
          updated_at: now
        };

        const clientBucketUpdate: Record<string, unknown> = {
          billing_period: clientBucketData.billing_period,
          overage_rate: clientBucketData.overage_rate,
          allow_rollover: clientBucketData.allow_rollover,
          updated_at: now
        };

        if (clientBucketColumns.total_minutes !== undefined) {
          clientBucketData.total_minutes = totalMinutes;
          clientBucketUpdate.total_minutes = totalMinutes;
        } else if (clientBucketColumns.total_hours !== undefined) {
          const totalHours = Math.round(totalMinutes / 60);
          clientBucketData.total_hours = totalHours;
          clientBucketUpdate.total_hours = totalHours;
        }

        await context.db('client_contract_service_bucket_config')
          .insert(clientBucketData)
          .onConflict(['tenant', 'config_id'])
          .merge(clientBucketUpdate);
      }
    }
  }

  return { configId, serviceId };
}

export async function createBucketUsageRecord(
  context: TestContext,
  options: CreateBucketUsageOptions
): Promise<string> {
  const usageColumns = await ensureBucketUsageColumns(context);

  if (!usageColumns) {
    throw new Error('bucket_usage table is unavailable');
  }

  const usageId = options.usageId ?? uuidv4();
  const contractLineId = options.contractLineId ?? options.planId;

  if (!contractLineId) {
    throw new Error('A contract line identifier is required to record bucket usage');
  }

  const record: Record<string, unknown> = {
    usage_id: usageId,
    tenant: context.tenantId,
    client_id: options.clientId,
    period_start: options.periodStart,
    period_end: options.periodEnd
  };

  if (usageColumns.minutes_used) {
    record.minutes_used = options.minutesUsed;
  } else if (usageColumns.hours_used) {
    record.hours_used = Math.round(options.minutesUsed / 60);
  }

  if (usageColumns.overage_minutes) {
    record.overage_minutes = options.overageMinutes ?? 0;
  } else if (usageColumns.overage_hours) {
    const overageHours = (options.overageMinutes ?? 0) / 60;
    record.overage_hours = Math.round(overageHours);
  }

  if (usageColumns.contract_line_id) {
    record.contract_line_id = contractLineId;
  }

  if (usageColumns.plan_id) {
    record.plan_id = options.planId ?? contractLineId;
  }

  if (usageColumns.service_catalog_id) {
    record.service_catalog_id = options.serviceId;
  } else if (usageColumns.service_id) {
    record.service_id = options.serviceId;
  }

  const rolledOverColumn = usageColumns.rolled_over_minutes ? 'rolled_over_minutes' : usageColumns.rolled_over_hours ? 'rolled_over_hours' : null;

  if (rolledOverColumn) {
    record[rolledOverColumn] = options.rolledOverMinutes ?? 0;
  }

  await context.db('bucket_usage').insert(record);

  return usageId;
}
