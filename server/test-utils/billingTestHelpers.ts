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
  billing_method?: 'fixed' | 'per_unit' | 'time';
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
  enableProration?: boolean;
  billingCycleAlignment?: 'start' | 'end' | 'prorated';
}

interface AddServiceToPlanOptions {
  quantity?: number;
  detailBaseRateCents?: number;
}

interface CreateBucketPlanOptions {
  planId?: string;
  clientBillingPlanId?: string;
  configId?: string;
  planName?: string;
  billingFrequency?: 'monthly' | 'quarterly' | 'annually';
  totalMinutes?: number;
  totalHours?: number;
  overageRateCents?: number;
  allowRollover?: boolean;
  billingPeriod?: string;
  startDate?: string;
  endDate?: string | null;
}

interface CreateBucketUsageOptions {
  usageId?: string;
  planId: string;
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
  billingMethod: 'fixed' | 'per_unit' = 'fixed'
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
    name: billingMethod === 'fixed' ? 'Fixed Service Type' : 'Per Unit Service Type',
    billing_method: billingMethod,
    is_active: true,
    description: 'Auto-generated service type for invoice tests',
    [tenantColumn]: context.tenantId
  };

  if (columns.order_number) {
    typeData.order_number = 1;
  }

  await context.db('service_types').insert(typeData);
  serviceTypeCache.set(cacheKey, typeId);
  return typeId;
}

export async function createTestService(
  context: TestContext,
  overrides: CreateServiceOptions = {}
): Promise<string> {
  const serviceId = overrides.service_id ?? uuidv4();
  const billingMethod = overrides.billing_method ?? 'fixed';
  const normalizedBillingMethod = billingMethod === 'time' ? 'per_unit' : billingMethod;
  const serviceTypeId = overrides.custom_service_type_id ?? await ensureServiceType(context, normalizedBillingMethod);

  const serviceData: Record<string, unknown> = {
    service_id: serviceId,
    tenant: context.tenantId,
    service_name: overrides.service_name ?? 'Test Service',
    billing_method: normalizedBillingMethod,
    default_rate: overrides.default_rate ?? 1000,
    unit_of_measure: overrides.unit_of_measure ?? 'each',
    custom_service_type_id: serviceTypeId,
    description: overrides.description ?? 'Test Service Description',
    category_id: overrides.category_id ?? null,
    tax_rate_id: overrides.tax_rate_id ?? null
  };

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

  // Primary contract line tables
  await context.db('contract_lines')
    .insert({
      contract_line_id: contractLineId,
      tenant: context.tenantId,
      contract_line_name: planName,
      billing_frequency: billingFrequency,
      is_custom: false,
      contract_line_type: 'Fixed'
    })
    .onConflict(['tenant', 'contract_line_id'])
    .merge({
      contract_line_name: planName,
      billing_frequency: billingFrequency,
      contract_line_type: 'Fixed'
    });

  await context.db('contract_line_fixed_config')
    .insert({
      contract_line_id: contractLineId,
      tenant: context.tenantId,
      base_rate: baseRateDollars,
      enable_proration: enableProration,
      billing_cycle_alignment: billingCycleAlignment
    })
    .onConflict(['tenant', 'contract_line_id'])
    .merge({
      base_rate: baseRateDollars,
      enable_proration: enableProration,
      billing_cycle_alignment: billingCycleAlignment
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
      client_id: context.clientId,
      contract_line_id: contractLineId,
      start_date: options.startDate ?? '2025-02-01',
      end_date: options.endDate ?? null,
      is_active: true
    })
    .onConflict(['tenant', 'client_contract_line_id'])
    .merge({
      client_id: context.clientId,
      contract_line_id: contractLineId,
      start_date: options.startDate ?? '2025-02-01',
      end_date: options.endDate ?? null,
      is_active: true
    });

  // Legacy plan tables (maintain compatibility with existing FKs until schema fully migrated)
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
      client_id: context.clientId,
      plan_id: legacyPlanId,
      service_category: null,
      is_active: true,
      start_date: options.startDate ?? '2025-02-01',
      end_date: options.endDate ?? null,
      client_bundle_id: null
    })
    .onConflict(['tenant', 'client_billing_plan_id'])
    .merge({
      client_id: context.clientId,
      plan_id: legacyPlanId,
      is_active: true,
      start_date: options.startDate ?? '2025-02-01',
      end_date: options.endDate ?? null
    });

  return {
    planId: legacyPlanId,
    clientBillingPlanId: legacyClientPlanId,
    contractLineId,
    clientContractLineId
  };
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

  return configId;
}

let bucketConfigColumnsCache: Record<string, unknown> | null | undefined;
let bucketUsageColumnsCache: Record<string, unknown> | null | undefined;

async function ensureBucketConfigColumns(context: TestContext): Promise<Record<string, unknown> | null> {
  if (bucketConfigColumnsCache === undefined) {
    try {
      bucketConfigColumnsCache = await context.db('plan_service_bucket_config').columnInfo();
    } catch (error) {
      bucketConfigColumnsCache = null;
    }
  }

  return bucketConfigColumnsCache ?? null;
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

export async function createBucketPlanAssignment(
  context: TestContext,
  serviceId: string,
  options: CreateBucketPlanOptions = {}
): Promise<{ planId: string; configId: string; clientBillingPlanId: string }> {
  const planId = options.planId ?? uuidv4();
  const clientBillingPlanId = options.clientBillingPlanId ?? uuidv4();
  const configId = options.configId ?? uuidv4();
  const planName = options.planName ?? 'Bucket Plan';
  const billingFrequency = options.billingFrequency ?? 'monthly';
  const startDate = options.startDate ?? '2025-01-01';
  const endDate = options.endDate ?? null;
  const overageRateCents = options.overageRateCents ?? 0;
  const allowRollover = options.allowRollover ?? false;
  const billingPeriod = options.billingPeriod ?? 'monthly';

  const totalMinutes = options.totalMinutes ?? Math.round((options.totalHours ?? 40) * 60);

  const existingPlan = await context.db('billing_plans')
    .where({ tenant: context.tenantId, plan_id: planId })
    .first();

  if (!existingPlan) {
    await context.db('billing_plans').insert({
      tenant: context.tenantId,
      plan_id: planId,
      plan_name: planName,
      billing_frequency: billingFrequency,
      is_custom: false,
      plan_type: 'Bucket'
    });
  }

  await context.db('plan_services')
    .insert({
      tenant: context.tenantId,
      plan_id: planId,
      service_id: serviceId,
      quantity: null,
      custom_rate: null
    })
    .onConflict(['tenant', 'plan_id', 'service_id'])
    .ignore();

  await context.db('plan_service_configuration')
    .insert({
      config_id: configId,
      plan_id: planId,
      service_id: serviceId,
      configuration_type: 'Bucket',
      custom_rate: null,
      quantity: null,
      tenant: context.tenantId
    });

  const bucketColumns = await ensureBucketConfigColumns(context);

  if (!bucketColumns) {
    throw new Error('plan_service_bucket_config table is unavailable');
  }

  const totalMinutesColumn = bucketColumns.total_minutes ? 'total_minutes' : bucketColumns.total_hours ? 'total_hours' : null;

  if (!totalMinutesColumn) {
    throw new Error('Unable to determine total minutes column for bucket config');
  }

  const bucketConfigData: Record<string, unknown> = {
    config_id: configId,
    tenant: context.tenantId,
    billing_period: billingPeriod,
    overage_rate: overageRateCents,
    allow_rollover: allowRollover
  };

  if (totalMinutesColumn === 'total_minutes') {
    bucketConfigData.total_minutes = totalMinutes;
  } else {
    bucketConfigData.total_hours = Math.round(totalMinutes / 60);
  }

  await context.db('plan_service_bucket_config').insert(bucketConfigData);

  const existingAssignment = await context.db('client_billing_plans')
    .where({ tenant: context.tenantId, client_id: context.clientId, plan_id: planId })
    .first();

  if (!existingAssignment) {
    await context.db('client_billing_plans').insert({
      tenant: context.tenantId,
      client_billing_plan_id: clientBillingPlanId,
      client_id: context.clientId,
      plan_id: planId,
      service_category: null,
      is_active: true,
      start_date: startDate,
      end_date: endDate,
      client_bundle_id: null
    });
  }

  return { planId, configId, clientBillingPlanId };
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
  const record: Record<string, unknown> = {
    usage_id: usageId,
    tenant: context.tenantId,
    client_id: options.clientId,
    plan_id: options.planId,
    service_catalog_id: options.serviceId,
    period_start: options.periodStart,
    period_end: options.periodEnd,
    minutes_used: options.minutesUsed,
    overage_minutes: options.overageMinutes ?? 0
  };

  const rolledOverColumn = usageColumns.rolled_over_minutes ? 'rolled_over_minutes' : usageColumns.rolled_over_hours ? 'rolled_over_hours' : null;

  if (rolledOverColumn) {
    record[rolledOverColumn] = options.rolledOverMinutes ?? 0;
  }

  await context.db('bucket_usage').insert(record);

  return usageId;
}
