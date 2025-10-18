import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { IContractLine } from 'server/src/interfaces/billing.interfaces';

interface CloneTemplateOptions {
  tenant: string;
  templateContractLineId: string;
  clientContractLineId: string;
  templateContractId?: string | null;
  overrideRate?: number | null;
  effectiveDate?: string | null;
}

interface CloneTemplateResult {
  appliedCustomRate: number | null;
}

/**
 * Normalize numeric database values (NUMERIC/DECIMAL) into nullable numbers.
 */
function normalizeNumeric(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Clone contract template data (terms, services, service configuration, pricing overrides)
 * into the client-specific tables.
 *
 * NOTE: This helper expects the Phase 1 schema migration to be applied so that the
 * `client_contract_*` tables exist.
 */
export async function cloneTemplateContractLine(
  trx: Knex.Transaction,
  options: CloneTemplateOptions
): Promise<CloneTemplateResult> {
  const {
    tenant,
    templateContractLineId,
    clientContractLineId,
    templateContractId = null,
    overrideRate = null,
    effectiveDate = null
  } = options;

  const contractLine = await trx<IContractLine>('contract_lines')
    .where('tenant', tenant)
    .where('contract_line_id', templateContractLineId)
    .first();

  if (!contractLine) {
    throw new Error(`Template contract line ${templateContractLineId} not found`);
  }

  await upsertClientContractLineTerms(trx, tenant, clientContractLineId, contractLine);
  await cloneServices(trx, tenant, templateContractLineId, clientContractLineId, effectiveDate);

  const templateCustomRate = await resolveTemplateCustomRate(
    trx,
    tenant,
    templateContractId,
    templateContractLineId
  );

  const appliedCustomRate = overrideRate ?? templateCustomRate;

  await trx('client_contract_line_pricing')
    .insert({
      tenant,
      client_contract_line_id: clientContractLineId,
      template_contract_line_id: templateContractLineId,
      template_contract_id: templateContractId,
      custom_rate: appliedCustomRate,
      created_at: trx.fn.now(),
      updated_at: trx.fn.now()
    })
    .onConflict(['tenant', 'client_contract_line_id'])
    .merge({
      template_contract_line_id: templateContractLineId,
      template_contract_id: templateContractId,
      custom_rate: appliedCustomRate,
      updated_at: trx.fn.now()
    });

  return { appliedCustomRate };
}

async function upsertClientContractLineTerms(
  trx: Knex.Transaction,
  tenant: string,
  clientContractLineId: string,
  contractLine: IContractLine
) {
  const payload = {
    tenant,
    client_contract_line_id: clientContractLineId,
    billing_frequency: contractLine.billing_frequency ?? null,
    enable_overtime: Boolean(contractLine.enable_overtime),
    overtime_rate: normalizeNumeric(contractLine.overtime_rate),
    overtime_threshold: contractLine.overtime_threshold ?? null,
    enable_after_hours_rate: Boolean(contractLine.enable_after_hours_rate),
    after_hours_multiplier: normalizeNumeric(contractLine.after_hours_multiplier),
    minimum_billable_time: contractLine.minimum_billable_time ?? null,
    round_up_to_nearest: contractLine.round_up_to_nearest ?? null,
    created_at: trx.fn.now(),
    updated_at: trx.fn.now()
  };

  await trx('client_contract_line_terms')
    .insert(payload)
    .onConflict(['tenant', 'client_contract_line_id'])
    .merge({
      billing_frequency: payload.billing_frequency,
      enable_overtime: payload.enable_overtime,
      overtime_rate: payload.overtime_rate,
      overtime_threshold: payload.overtime_threshold,
      enable_after_hours_rate: payload.enable_after_hours_rate,
      after_hours_multiplier: payload.after_hours_multiplier,
      minimum_billable_time: payload.minimum_billable_time,
      round_up_to_nearest: payload.round_up_to_nearest,
      updated_at: trx.fn.now()
    });
}

async function cloneServices(
  trx: Knex.Transaction,
  tenant: string,
  templateContractLineId: string,
  clientContractLineId: string,
  effectiveDate: string | null
) {
  type TemplateServiceRow = {
    service_id: string;
    quantity: number | null;
    custom_rate: number | string | null;
  };

  const services = await trx<TemplateServiceRow>('contract_line_services')
    .where('tenant', tenant)
    .where('contract_line_id', templateContractLineId)
    .select('service_id', 'quantity', 'custom_rate');

  for (const service of services) {
    const clientContractServiceId = uuidv4();

    await trx('client_contract_services')
      .insert({
        tenant,
        client_contract_service_id: clientContractServiceId,
        client_contract_line_id: clientContractLineId,
        service_id: service.service_id,
        quantity: service.quantity,
        custom_rate: normalizeNumeric(service.custom_rate),
        effective_date: effectiveDate,
        created_at: trx.fn.now(),
        updated_at: trx.fn.now()
      })
      .onConflict(['tenant', 'client_contract_line_id', 'service_id'])
      .merge({
        quantity: service.quantity,
        custom_rate: normalizeNumeric(service.custom_rate),
        effective_date: effectiveDate,
        updated_at: trx.fn.now()
      });

    await cloneServiceConfiguration(
      trx,
      tenant,
      templateContractLineId,
      service.service_id,
      clientContractServiceId
    );
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
  serviceId: string,
  clientContractServiceId: string
) {
  const configurations = await trx<TemplateServiceConfigurationRow>('contract_line_service_configuration')
    .where('tenant', tenant)
    .where('contract_line_id', templateContractLineId)
    .where('service_id', serviceId)
    .select('config_id', 'configuration_type', 'custom_rate', 'quantity');

  for (const configuration of configurations) {
    const newConfigId = uuidv4();

    await trx('client_contract_service_configuration').insert({
      tenant,
      config_id: newConfigId,
      client_contract_service_id: clientContractServiceId,
      configuration_type: configuration.configuration_type,
      custom_rate: normalizeNumeric(configuration.custom_rate),
      quantity: configuration.quantity,
      created_at: trx.fn.now(),
      updated_at: trx.fn.now()
    });

    await cloneBucketConfig(trx, tenant, configuration.config_id, newConfigId);
    await cloneFixedConfig(trx, tenant, configuration.config_id, newConfigId);
    await cloneHourlyConfig(trx, tenant, configuration.config_id, newConfigId);
    await cloneHourlyRates(trx, tenant, configuration.config_id, newConfigId);
    await cloneUserTypeRates(trx, tenant, configuration.config_id, newConfigId);
    await cloneRateTiers(trx, tenant, configuration.config_id, newConfigId);
    await cloneUsageConfig(trx, tenant, configuration.config_id, newConfigId);
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
  targetConfigId: string
) {
  const bucketConfig = await trx<TemplateBucketConfigRow>('contract_line_service_bucket_config')
    .where('tenant', tenant)
    .where('config_id', sourceConfigId)
    .first('total_minutes', 'billing_period', 'overage_rate', 'allow_rollover');

  if (!bucketConfig) return;

  await trx('client_contract_service_bucket_config').insert({
    tenant,
    config_id: targetConfigId,
    total_minutes: bucketConfig.total_minutes,
    billing_period: bucketConfig.billing_period,
    overage_rate: normalizeNumeric(bucketConfig.overage_rate) ?? 0,
    allow_rollover: bucketConfig.allow_rollover,
    created_at: trx.fn.now(),
    updated_at: trx.fn.now()
  });
}

type TemplateFixedConfigRow = {
  base_rate: number | string | null;
  enable_proration: boolean;
  billing_cycle_alignment: string | null;
};

async function cloneFixedConfig(
  trx: Knex.Transaction,
  tenant: string,
  sourceConfigId: string,
  targetConfigId: string
) {
  const fixedConfig = await trx<TemplateFixedConfigRow>('contract_line_service_fixed_config')
    .where('tenant', tenant)
    .where('config_id', sourceConfigId)
    .first('base_rate', 'enable_proration', 'billing_cycle_alignment');

  if (!fixedConfig) return;

  await trx('client_contract_service_fixed_config').insert({
    tenant,
    config_id: targetConfigId,
    base_rate: normalizeNumeric(fixedConfig.base_rate),
    enable_proration: Boolean(fixedConfig.enable_proration),
    billing_cycle_alignment: fixedConfig.billing_cycle_alignment,
    created_at: trx.fn.now(),
    updated_at: trx.fn.now()
  });
}

type TemplateHourlyConfigRow = {
  minimum_billable_time: number;
  round_up_to_nearest: number;
  enable_overtime: boolean;
  overtime_rate: number | string | null;
  overtime_threshold: number | null;
  enable_after_hours_rate: boolean;
  after_hours_multiplier: number | string | null;
};

async function cloneHourlyConfig(
  trx: Knex.Transaction,
  tenant: string,
  sourceConfigId: string,
  targetConfigId: string
) {
  const hourlyConfig = await trx<TemplateHourlyConfigRow>('contract_line_service_hourly_config')
    .where('tenant', tenant)
    .where('config_id', sourceConfigId)
    .first(
      'minimum_billable_time',
      'round_up_to_nearest',
      'enable_overtime',
      'overtime_rate',
      'overtime_threshold',
      'enable_after_hours_rate',
      'after_hours_multiplier'
    );

  if (!hourlyConfig) return;

  await trx('client_contract_service_hourly_config').insert({
    tenant,
    config_id: targetConfigId,
    minimum_billable_time: hourlyConfig.minimum_billable_time,
    round_up_to_nearest: hourlyConfig.round_up_to_nearest,
    enable_overtime: Boolean(hourlyConfig.enable_overtime),
    overtime_rate: normalizeNumeric(hourlyConfig.overtime_rate),
    overtime_threshold: hourlyConfig.overtime_threshold,
    enable_after_hours_rate: Boolean(hourlyConfig.enable_after_hours_rate),
    after_hours_multiplier: normalizeNumeric(hourlyConfig.after_hours_multiplier),
    created_at: trx.fn.now(),
    updated_at: trx.fn.now()
  });
}

type TemplateHourlyRateRow = {
  hourly_rate: number | string | null;
  minimum_billable_time: number;
  round_up_to_nearest: number;
};

async function cloneHourlyRates(
  trx: Knex.Transaction,
  tenant: string,
  sourceConfigId: string,
  targetConfigId: string
) {
  const hourlyRates = await trx<TemplateHourlyRateRow>('contract_line_service_hourly_configs')
    .where('tenant', tenant)
    .where('config_id', sourceConfigId)
    .select('hourly_rate', 'minimum_billable_time', 'round_up_to_nearest');

  for (const hourlyRate of hourlyRates) {
    await trx('client_contract_service_hourly_configs').insert({
      tenant,
      config_id: targetConfigId,
      hourly_rate: normalizeNumeric(hourlyRate.hourly_rate) ?? 0,
      minimum_billable_time: hourlyRate.minimum_billable_time,
      round_up_to_nearest: hourlyRate.round_up_to_nearest,
      created_at: trx.fn.now(),
      updated_at: trx.fn.now()
    });
  }
}

type TemplateUserTypeRateRow = {
  user_type: string;
  rate: number | string | null;
};

async function cloneUserTypeRates(
  trx: Knex.Transaction,
  tenant: string,
  sourceConfigId: string,
  targetConfigId: string
) {
  const userTypeRates = await trx<TemplateUserTypeRateRow>('user_type_rates')
    .where('tenant', tenant)
    .where('config_id', sourceConfigId)
    .select('user_type', 'rate');

  if (!userTypeRates.length) {
    return;
  }

  await trx('user_type_rates')
    .where('tenant', tenant)
    .where('config_id', targetConfigId)
    .delete();

  for (const rate of userTypeRates) {
    await trx('user_type_rates').insert({
      tenant,
      rate_id: uuidv4(),
      config_id: targetConfigId,
      user_type: rate.user_type,
      rate: normalizeNumeric(rate.rate) ?? 0,
      created_at: trx.fn.now(),
      updated_at: trx.fn.now()
    });
  }
}

type TemplateRateTierRow = {
  min_quantity: number;
  max_quantity: number | null;
  rate: number | string | null;
};

async function cloneRateTiers(
  trx: Knex.Transaction,
  tenant: string,
  sourceConfigId: string,
  targetConfigId: string
) {
  const rateTiers = await trx<TemplateRateTierRow>('contract_line_service_rate_tiers')
    .where('tenant', tenant)
    .where('config_id', sourceConfigId)
    .select('min_quantity', 'max_quantity', 'rate');

  for (const rateTier of rateTiers) {
    await trx('client_contract_service_rate_tiers').insert({
      tenant,
      tier_id: uuidv4(),
      config_id: targetConfigId,
      min_quantity: rateTier.min_quantity,
      max_quantity: rateTier.max_quantity,
      rate: normalizeNumeric(rateTier.rate) ?? 0,
      created_at: trx.fn.now(),
      updated_at: trx.fn.now()
    });
  }
}

type TemplateUsageConfigRow = {
  unit_of_measure: string;
  enable_tiered_pricing: boolean;
  minimum_usage: number;
  base_rate: number | string | null;
};

async function cloneUsageConfig(
  trx: Knex.Transaction,
  tenant: string,
  sourceConfigId: string,
  targetConfigId: string
) {
  const usageConfig = await trx<TemplateUsageConfigRow>('contract_line_service_usage_config')
    .where('tenant', tenant)
    .where('config_id', sourceConfigId)
    .first('unit_of_measure', 'enable_tiered_pricing', 'minimum_usage', 'base_rate');

  if (!usageConfig) return;

  await trx('client_contract_service_usage_config').insert({
    tenant,
    config_id: targetConfigId,
    unit_of_measure: usageConfig.unit_of_measure,
    enable_tiered_pricing: Boolean(usageConfig.enable_tiered_pricing),
    minimum_usage: usageConfig.minimum_usage,
    base_rate: normalizeNumeric(usageConfig.base_rate),
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

  type TemplateMappingRow = { custom_rate: number | string | null };

  const mapping = await trx<TemplateMappingRow>('contract_line_mappings')
    .where('tenant', tenant)
    .where('contract_id', templateContractId)
    .where('contract_line_id', templateContractLineId)
    .first('custom_rate');

  if (!mapping) {
    return null;
  }

  return mapping.custom_rate != null ? normalizeNumeric(mapping.custom_rate) : null;
}
