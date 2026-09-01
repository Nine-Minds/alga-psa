import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { v4 as uuidv4 } from 'uuid';
import type { IContractTemplateLine } from '@alga-psa/types';

interface CloneTemplateOptions {
  tenant: string;
  templateContractLineId: string;
  contractLineId: string;
  templateContractId?: string | null;
  overrideRate?: number | null;
  effectiveDate?: string | null;
}

interface CloneTemplateResult {
  appliedCustomRate: number | null;
}

function normalizeNumeric(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function cloneTemplateContractLine(
  trx: Knex.Transaction,
  options: CloneTemplateOptions
): Promise<CloneTemplateResult> {
  const { tenant, templateContractLineId, contractLineId, templateContractId = null, overrideRate = null } = options;

  if (!contractLineId) {
    throw new Error('contractLineId is required');
  }

  const db = tenantDb(trx, tenant);
  const templateLine = await db.table<IContractTemplateLine>('contract_template_lines')
    .where('template_line_id', templateContractLineId)
    .first();

  if (!templateLine) {
    throw new Error(`Template contract line ${templateContractLineId} not found`);
  }

  // Full pool config round-trip: when the template carries template pool rows,
  // clone the WHOLE pool (scope incl. catch-all, membership, multipliers,
  // schedule, after-hours rule) and skip the legacy per-config bucket clone.
  const hasTemplatePools = await cloneTemplateLinePools(trx, tenant, templateContractLineId, contractLineId);
  await cloneServices(trx, tenant, templateContractLineId, contractLineId, hasTemplatePools);

  const templateCustomRate = await resolveTemplateCustomRate(trx, tenant, templateContractId, templateContractLineId);
  const appliedCustomRate = overrideRate ?? templateCustomRate;

  if (appliedCustomRate !== null) {
    await db.table('contract_lines')
      .where({ contract_line_id: contractLineId })
      .update({
        custom_rate: appliedCustomRate,
        updated_at: trx.fn.now()
      });
  }

  return { appliedCustomRate };
}

/**
 * Clone a template line's bucket POOLS (weighted-burn model) into a live
 * contract line. Returns true when the template carried pool rows (i.e. the
 * pool config was cloned here and the legacy per-config bucket clone must be
 * skipped), false when the template predates the pool tables and the caller
 * should fall back to cloning the legacy single-member bucket configs.
 */
/**
 * LEVERAGE: pattern template-pool-roundtrip — every template clone path
 * (shared/billingClients/templateClone, billing's templateClone, and the two
 * contractLineRepository copies) must copy a line's bucket POOLS in full
 * (scope, membership, multipliers, schedule, after-hours rule); this module
 * owns that copy so the paths stay in lockstep.
 */
export async function cloneTemplateLinePools(
  trx: Knex | Knex.Transaction,
  tenant: string,
  templateContractLineId: string,
  contractLineId: string
): Promise<boolean> {
  const db = tenantDb(trx, tenant);
  const templatePools = await db.table('contract_template_line_buckets')
    .where('template_line_id', templateContractLineId)
    .select('*');

  if (!templatePools || templatePools.length === 0) {
    return false;
  }

  for (const pool of templatePools) {
    const newBucketId = uuidv4();
    await db.table('contract_line_buckets').insert({
      tenant,
      bucket_id: newBucketId,
      contract_line_id: contractLineId,
      bucket_name: pool.bucket_name ?? null,
      total_minutes: pool.total_minutes,
      overage_rate: normalizeNumeric(pool.overage_rate) ?? 0,
      allow_rollover: pool.allow_rollover,
      billing_period: pool.billing_period ?? 'monthly',
      after_hours_multiplier: pool.after_hours_multiplier ?? null,
      business_hours_schedule_id: pool.business_hours_schedule_id ?? null,
      covers_all_services: pool.covers_all_services,
      created_at: trx.fn.now(),
      updated_at: trx.fn.now(),
    });

    const members = await db.table('contract_template_line_bucket_services')
      .where('bucket_id', pool.bucket_id)
      .select('service_id', 'burn_multiplier');

    for (const member of members) {
      await db.table('contract_line_bucket_services').insert({
        tenant,
        bucket_id: newBucketId,
        service_id: member.service_id,
        contract_line_id: contractLineId,
        burn_multiplier: Number(member.burn_multiplier) || 1,
        created_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      });
    }
  }

  return true;
}

async function cloneServices(trx: Knex.Transaction, tenant: string, templateContractLineId: string, contractLineId: string, hasTemplatePools = false) {
  type TemplateServiceRow = {
    service_id: string;
    quantity: number | null;
    custom_rate: number | string | null;
  };

  const db = tenantDb(trx, tenant);
  const services = await db.table<TemplateServiceRow>('contract_template_line_services')
    .where('template_line_id', templateContractLineId)
    .select('service_id', 'quantity', 'custom_rate');

  for (const service of services) {
    // contract_line_services has no timestamp columns (see the other writers
    // in contractWizardActions/contractLinePresetActions).
    await db.table('contract_line_services')
      .insert({
        tenant,
        contract_line_id: contractLineId,
        service_id: service.service_id,
        quantity: service.quantity,
        custom_rate: normalizeNumeric(service.custom_rate)
      })
      .onConflict(['tenant', 'contract_line_id', 'service_id'])
      .merge({
        quantity: service.quantity,
        custom_rate: normalizeNumeric(service.custom_rate)
      });

    await cloneServiceConfiguration(trx, tenant, templateContractLineId, contractLineId, service.service_id, hasTemplatePools);
  }
}

type TemplateServiceConfigurationRow = {
  config_id: string;
  configuration_type: string;
  custom_rate: number | string | null;
  quantity: number | null;
};

async function cloneServiceConfiguration(
  trx: Knex.Transaction,
  tenant: string,
  templateContractLineId: string,
  contractLineId: string,
  serviceId: string,
  hasTemplatePools: boolean
) {
  const db = tenantDb(trx, tenant);
  const configurations = await db.table<TemplateServiceConfigurationRow>('contract_template_line_service_configuration')
    .where('template_line_id', templateContractLineId)
    .where('service_id', serviceId)
    .select('config_id', 'configuration_type', 'custom_rate', 'quantity');

  for (const configuration of configurations) {
    const newConfigId = uuidv4();

    await db.table('contract_line_service_configuration').insert({
      tenant,
      config_id: newConfigId,
      contract_line_id: contractLineId,
      service_id: serviceId,
      configuration_type: configuration.configuration_type,
      custom_rate: normalizeNumeric(configuration.custom_rate),
      quantity: configuration.quantity,
      created_at: trx.fn.now(),
      updated_at: trx.fn.now()
    });

    // When the template carries pool rows, the pools were already cloned in
    // full by cloneTemplateLinePools — cloning the legacy per-config bucket
    // here would mint a duplicate pool.
    if (configuration.configuration_type === 'Bucket' && !hasTemplatePools) {
      await cloneBucketConfig(trx, tenant, configuration.config_id, newConfigId, contractLineId, serviceId);
    }

    if (configuration.configuration_type === 'Hourly') {
      await cloneHourlyConfig(trx, tenant, configuration.config_id, newConfigId, configuration);
    }

    if (configuration.configuration_type === 'Usage') {
      await cloneUsageConfig(trx, tenant, configuration.config_id, newConfigId, configuration);
    }

    if (configuration.configuration_type === 'Fixed') {
      await cloneFixedConfig(trx, tenant, configuration.config_id, newConfigId);
    }
  }
}

type TemplateBucketConfigRow = {
  total_minutes: number;
  billing_period: string;
  overage_rate: number | string | null;
  allow_rollover: boolean;
};

async function cloneBucketConfig(
  trx: Knex.Transaction,
  tenant: string,
  sourceConfigId: string,
  targetConfigId: string,
  contractLineId: string,
  serviceId: string
) {
  const db = tenantDb(trx, tenant);
  const bucketConfig = await db.table<TemplateBucketConfigRow>('contract_template_line_service_bucket_config')
    .where('config_id', sourceConfigId)
    .first('total_minutes', 'billing_period', 'overage_rate', 'allow_rollover');

  if (!bucketConfig) return;

  // Weighted-burn model: a bucket is a line-owned pool with a single-member 1x
  // member row. The legacy contract_line_service_bucket_config table is frozen;
  // cloning into it would produce a bucket that never bills or burns.
  await db.table('contract_line_buckets').insert({
    tenant,
    bucket_id: targetConfigId,
    contract_line_id: contractLineId,
    bucket_name: null,
    total_minutes: bucketConfig.total_minutes,
    overage_rate: normalizeNumeric(bucketConfig.overage_rate) ?? 0,
    allow_rollover: bucketConfig.allow_rollover,
    billing_period: bucketConfig.billing_period,
    after_hours_multiplier: null,
    business_hours_schedule_id: null,
    covers_all_services: false,
    created_at: trx.fn.now(),
    updated_at: trx.fn.now()
  });
  await db.table('contract_line_bucket_services').insert({
    tenant,
    bucket_id: targetConfigId,
    service_id: serviceId,
    contract_line_id: contractLineId,
    burn_multiplier: 1,
    created_at: trx.fn.now(),
    updated_at: trx.fn.now()
  });
}

type TemplateHourlyConfigRow = {
  billing_period: string;
  hourly_rate: number | string | null;
  user_type_rates?: any;
};

async function cloneHourlyConfig(
  trx: Knex.Transaction,
  tenant: string,
  sourceConfigId: string,
  targetConfigId: string,
  configuration: TemplateServiceConfigurationRow
) {
  const db = tenantDb(trx, tenant);
  const hourlyConfig = await db.table<TemplateHourlyConfigRow>('contract_template_line_service_hourly_config')
    .where('config_id', sourceConfigId)
    .first('billing_period', 'hourly_rate', 'user_type_rates');

  if (!hourlyConfig) return;

  await db.table('contract_line_service_hourly_config').insert({
    tenant,
    config_id: targetConfigId,
    billing_period: hourlyConfig.billing_period,
    hourly_rate: normalizeNumeric(hourlyConfig.hourly_rate) ?? normalizeNumeric(configuration.custom_rate) ?? 0,
    user_type_rates: hourlyConfig.user_type_rates ?? null,
    created_at: trx.fn.now(),
    updated_at: trx.fn.now()
  });
}

type TemplateUsageConfigRow = {
  billing_period: string;
  unit_name: string | null;
  included_units: number | null;
  overage_rate: number | string | null;
};

async function cloneUsageConfig(trx: Knex.Transaction, tenant: string, sourceConfigId: string, targetConfigId: string, configuration: TemplateServiceConfigurationRow) {
  const db = tenantDb(trx, tenant);
  const usageConfig = await db.table<TemplateUsageConfigRow>('contract_template_line_service_usage_config')
    .where('config_id', sourceConfigId)
    .first('billing_period', 'unit_name', 'included_units', 'overage_rate');

  if (!usageConfig) return;

  await db.table('contract_line_service_usage_config').insert({
    tenant,
    config_id: targetConfigId,
    billing_period: usageConfig.billing_period,
    unit_name: usageConfig.unit_name,
    included_units: usageConfig.included_units,
    overage_rate: normalizeNumeric(usageConfig.overage_rate) ?? normalizeNumeric(configuration.custom_rate) ?? 0,
    created_at: trx.fn.now(),
    updated_at: trx.fn.now()
  });
}

async function cloneFixedConfig(trx: Knex.Transaction, tenant: string, sourceConfigId: string, targetConfigId: string) {
  const db = tenantDb(trx, tenant);
  const fixedConfig = await db.table('contract_template_line_service_fixed_config')
    .where('config_id', sourceConfigId)
    .first();

  if (!fixedConfig) return;

  await db.table('contract_line_service_fixed_config').insert({
    ...fixedConfig,
    tenant,
    config_id: targetConfigId,
    created_at: trx.fn.now(),
    updated_at: trx.fn.now()
  });
}

async function resolveTemplateCustomRate(
  trx: Knex.Transaction,
  tenant: string,
  templateContractId: string | null,
  templateContractLineId: string
): Promise<number | null> {
  if (!templateContractId) {
    return null;
  }

  type CustomRateRow = { custom_rate: number | string | null };

  const templateLine = await tenantDb(trx, tenant).table<CustomRateRow>('contract_template_lines')
    .where('template_id', templateContractId)
    .where('template_line_id', templateContractLineId)
    .first('custom_rate');

  if (templateLine && templateLine.custom_rate != null) {
    return normalizeNumeric(templateLine.custom_rate);
  }

  return null;
}
