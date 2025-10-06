import { v4 as uuidv4 } from 'uuid';
import type { TestContext } from './testContext';

interface SetupTaxOptions {
  regionCode?: string;
  regionName?: string;
  taxPercentage?: number;
  startDate?: string;
  description?: string;
  companyId?: string;
}

interface AssignServiceTaxRateOptions {
  onlyUnset?: boolean;
}

let companyTaxSettingsColumnsCache: Record<string, unknown> | null | undefined;
let companyTaxRatesColumnsCache: Record<string, unknown> | null | undefined;
const serviceTypeCache = new Map<string, string>();

export async function setupCompanyTaxConfiguration(
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

  const targetCompanyId = options.companyId ?? context.companyId;

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

  await upsertCompanyTaxSettings(context, taxRateId, targetCompanyId);
  await upsertCompanyDefaultTaxRate(context, taxRateId, targetCompanyId);
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

async function upsertCompanyTaxSettings(
  context: TestContext,
  taxRateId: string,
  companyId: string
): Promise<void> {
  try {
    if (companyTaxSettingsColumnsCache === undefined) {
      companyTaxSettingsColumnsCache = await context.db('company_tax_settings').columnInfo();
    }
  } catch (error) {
    companyTaxSettingsColumnsCache = null;
  }

  if (!companyTaxSettingsColumnsCache || Object.keys(companyTaxSettingsColumnsCache).length === 0) {
    return;
  }

  const companyExists = await context.db('companies')
    .where({ tenant: context.tenantId, company_id: companyId })
    .first();

  if (!companyExists) {
    return;
  }

  const baseData: Record<string, unknown> = {
    tenant: context.tenantId,
    company_id: companyId,
    is_reverse_charge_applicable: false
  };

  if ('tax_rate_id' in companyTaxSettingsColumnsCache) {
    baseData.tax_rate_id = taxRateId;
  }

  await context.db('company_tax_settings')
    .insert(baseData)
    .onConflict(['tenant', 'company_id'])
    .merge(baseData);
}

async function upsertCompanyDefaultTaxRate(
  context: TestContext,
  taxRateId: string,
  companyId: string
): Promise<void> {
  try {
    if (companyTaxRatesColumnsCache === undefined) {
      companyTaxRatesColumnsCache = await context.db('company_tax_rates').columnInfo();
    }
  } catch (error) {
    companyTaxRatesColumnsCache = null;
  }

  if (!companyTaxRatesColumnsCache || Object.keys(companyTaxRatesColumnsCache).length === 0) {
    return;
  }

  const companyExists = await context.db('companies')
    .where({ tenant: context.tenantId, company_id: companyId })
    .first();

  if (!companyExists) {
    return;
  }

  if ('is_default' in companyTaxRatesColumnsCache) {
    await context.db('company_tax_rates')
      .where({ tenant: context.tenantId, company_id: companyId })
      .update({ is_default: false });
  }

  const rateData: Record<string, unknown> = {
    tenant: context.tenantId,
    company_id: companyId,
    tax_rate_id: taxRateId
  };

  if ('is_default' in companyTaxRatesColumnsCache) {
    rateData.is_default = true;
  }

  if ('location_id' in companyTaxRatesColumnsCache) {
    rateData.location_id = null;
  }

  await context.db('company_tax_rates')
    .insert(rateData)
    .onConflict(['company_id', 'tax_rate_id', 'tenant'])
    .merge(rateData);
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
  companyBillingPlanId?: string;
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
  companyBillingPlanId?: string;
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
  companyId: string;
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
): Promise<{ planId: string; companyBillingPlanId: string }> {
  const planId = options.planId ?? uuidv4();
  const companyBillingPlanId = options.companyBillingPlanId ?? uuidv4();
  const configId = uuidv4();
  const baseRateCents = options.baseRateCents ?? 1000;
  const baseRateDollars = baseRateCents / 100;
  const detailBaseRateCents = options.detailBaseRateCents ?? baseRateCents;
  const detailBaseRateDollars = detailBaseRateCents / 100;
  const enableProration = options.enableProration ?? false;
  const billingCycleAlignment = options.billingCycleAlignment ?? 'start';

  const existingPlan = await context.db('billing_plans')
    .where({ plan_id: planId, tenant: context.tenantId })
    .first();

  if (!existingPlan) {
    await context.db('billing_plans')
      .insert({
        plan_id: planId,
        tenant: context.tenantId,
        plan_name: options.planName ?? 'Test Plan',
        billing_frequency: options.billingFrequency ?? 'monthly',
        is_custom: false,
        plan_type: 'Fixed'
      });
  }

  await context.db('billing_plan_fixed_config')
    .insert({
      plan_id: planId,
      tenant: context.tenantId,
      base_rate: baseRateDollars,
      enable_proration: enableProration,
      billing_cycle_alignment: billingCycleAlignment
    })
    .onConflict(['tenant', 'plan_id'])
    .merge({
      base_rate: baseRateDollars,
      enable_proration: enableProration,
      billing_cycle_alignment: billingCycleAlignment,
      updated_at: context.db.fn.now()
    });

  await context.db('plan_service_configuration')
    .insert({
      config_id: configId,
      plan_id: planId,
      service_id: serviceId,
      configuration_type: 'Fixed',
      custom_rate: null,
      quantity: options.quantity ?? 1,
      tenant: context.tenantId
    });

  await context.db('plan_service_fixed_config')
    .insert({
      config_id: configId,
      tenant: context.tenantId,
      base_rate: detailBaseRateDollars
    });

  const existingAssignment = await context.db('company_billing_plans')
    .where({ tenant: context.tenantId, company_id: context.companyId, plan_id: planId })
    .first();

  if (!existingAssignment) {
    await context.db('company_billing_plans')
      .insert({
        tenant: context.tenantId,
        company_billing_plan_id: companyBillingPlanId,
        company_id: context.companyId,
        plan_id: planId,
        service_category: null,
        is_active: true,
        start_date: options.startDate ?? '2025-02-01',
        end_date: options.endDate ?? null,
        company_bundle_id: null
      });
  }

  return { planId, companyBillingPlanId };
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
): Promise<{ planId: string; configId: string; companyBillingPlanId: string }> {
  const planId = options.planId ?? uuidv4();
  const companyBillingPlanId = options.companyBillingPlanId ?? uuidv4();
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

  const existingAssignment = await context.db('company_billing_plans')
    .where({ tenant: context.tenantId, company_id: context.companyId, plan_id: planId })
    .first();

  if (!existingAssignment) {
    await context.db('company_billing_plans').insert({
      tenant: context.tenantId,
      company_billing_plan_id: companyBillingPlanId,
      company_id: context.companyId,
      plan_id: planId,
      service_category: null,
      is_active: true,
      start_date: startDate,
      end_date: endDate,
      company_bundle_id: null
    });
  }

  return { planId, configId, companyBillingPlanId };
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
    company_id: options.companyId,
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
