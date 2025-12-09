import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { IContractTemplateLine } from 'server/src/interfaces/contractTemplate.interfaces';

interface CloneTemplateOptions {
  tenant: string;
  templateContractLineId: string;
  /** The contract_line_id to clone into */
  contractLineId: string;
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
 * Clone contract template data (services, service configuration)
 * into the contract_line_* tables.
 *
 * This copies from contract_template_line_* tables to contract_line_* tables.
 * The contract_line should already exist before calling this function.
 */
export async function cloneTemplateContractLine(
  trx: Knex.Transaction,
  options: CloneTemplateOptions
): Promise<CloneTemplateResult> {
  const {
    tenant,
    templateContractLineId,
    contractLineId,
    templateContractId = null,
    overrideRate = null,
  } = options;

  if (!contractLineId) {
    throw new Error('contractLineId is required');
  }

  const targetContractLineId = contractLineId;

  const templateLine = await trx<IContractTemplateLine>('contract_template_lines')
    .where('tenant', tenant)
    .where('template_line_id', templateContractLineId)
    .first();

  if (!templateLine) {
    throw new Error(`Template contract line ${templateContractLineId} not found`);
  }

  // Clone services from template to contract_line_services
  await cloneServices(trx, tenant, templateContractLineId, targetContractLineId);

  // Resolve the custom rate to apply
  const templateCustomRate = await resolveTemplateCustomRate(
    trx,
    tenant,
    templateContractId,
    templateContractLineId
  );

  const appliedCustomRate = overrideRate ?? templateCustomRate;

  // Update the contract_line's custom_rate directly (no separate pricing table needed)
  if (appliedCustomRate !== null) {
    await trx('contract_lines')
      .where({ tenant, contract_line_id: targetContractLineId })
      .update({
        custom_rate: appliedCustomRate,
        updated_at: trx.fn.now()
      });
  }

  return { appliedCustomRate };
}

async function cloneServices(
  trx: Knex.Transaction,
  tenant: string,
  templateContractLineId: string,
  contractLineId: string
) {
  type TemplateServiceRow = {
    service_id: string;
    quantity: number | null;
    custom_rate: number | string | null;
  };

  const services = await trx<TemplateServiceRow>('contract_template_line_services')
    .where('tenant', tenant)
    .where('template_line_id', templateContractLineId)
    .select('service_id', 'quantity', 'custom_rate');

  for (const service of services) {
    // Insert into contract_line_services
    await trx('contract_line_services')
      .insert({
        tenant,
        contract_line_id: contractLineId,
        service_id: service.service_id,
        quantity: service.quantity,
        custom_rate: normalizeNumeric(service.custom_rate),
        created_at: trx.fn.now(),
        updated_at: trx.fn.now()
      })
      .onConflict(['tenant', 'contract_line_id', 'service_id'])
      .merge({
        quantity: service.quantity,
        custom_rate: normalizeNumeric(service.custom_rate),
        updated_at: trx.fn.now()
      });

    await cloneServiceConfiguration(
      trx,
      tenant,
      templateContractLineId,
      contractLineId,
      service.service_id
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
  contractLineId: string,
  serviceId: string
) {
  const configurations = await trx<TemplateServiceConfigurationRow>('contract_template_line_service_configuration')
    .where('tenant', tenant)
    .where('template_line_id', templateContractLineId)
    .where('service_id', serviceId)
    .select('config_id', 'configuration_type', 'custom_rate', 'quantity');

  for (const configuration of configurations) {
    const newConfigId = uuidv4();

    // Insert into contract_line_service_configuration
    await trx('contract_line_service_configuration').insert({
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

    if (configuration.configuration_type === 'Bucket') {
      await cloneBucketConfig(trx, tenant, configuration.config_id, newConfigId);
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
  targetConfigId: string
) {
  const bucketConfig = await trx<TemplateBucketConfigRow>('contract_template_line_service_bucket_config')
    .where('tenant', tenant)
    .where('config_id', sourceConfigId)
    .first('total_minutes', 'billing_period', 'overage_rate', 'allow_rollover');

  if (!bucketConfig) return;

  await trx('contract_line_service_bucket_config').insert({
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
};

async function cloneFixedConfig(
  trx: Knex.Transaction,
  tenant: string,
  sourceConfigId: string,
  targetConfigId: string
) {
  const fixedConfig = await trx<TemplateFixedConfigRow>('contract_template_line_service_fixed_config')
    .where('tenant', tenant)
    .where('config_id', sourceConfigId)
    .first('base_rate');

  if (!fixedConfig) return;

  await trx('contract_line_service_fixed_config').insert({
    tenant,
    config_id: targetConfigId,
    base_rate: normalizeNumeric(fixedConfig.base_rate),
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
  targetConfigId: string,
  configuration: TemplateServiceConfigurationRow
) {
  const hourlyConfig = await trx<TemplateHourlyConfigRow>('contract_template_line_service_hourly_config')
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

  await trx('contract_line_service_hourly_config')
    .insert({
      tenant,
      config_id: targetConfigId,
      minimum_billable_time: hourlyConfig?.minimum_billable_time ?? 15,
      round_up_to_nearest: hourlyConfig?.round_up_to_nearest ?? 15,
      enable_overtime: Boolean(hourlyConfig?.enable_overtime),
      overtime_rate: normalizeNumeric(hourlyConfig?.overtime_rate),
      overtime_threshold: hourlyConfig?.overtime_threshold ?? null,
      enable_after_hours_rate: Boolean(hourlyConfig?.enable_after_hours_rate),
      after_hours_multiplier: normalizeNumeric(hourlyConfig?.after_hours_multiplier),
      created_at: trx.fn.now(),
      updated_at: trx.fn.now(),
    })
    .onConflict(['tenant', 'config_id'])
    .merge({
      minimum_billable_time: hourlyConfig?.minimum_billable_time ?? 15,
      round_up_to_nearest: hourlyConfig?.round_up_to_nearest ?? 15,
      enable_overtime: Boolean(hourlyConfig?.enable_overtime),
      overtime_rate: normalizeNumeric(hourlyConfig?.overtime_rate),
      overtime_threshold: hourlyConfig?.overtime_threshold ?? null,
      enable_after_hours_rate: Boolean(hourlyConfig?.enable_after_hours_rate),
      after_hours_multiplier: normalizeNumeric(hourlyConfig?.after_hours_multiplier),
      updated_at: trx.fn.now(),
    });

  await trx('contract_line_service_hourly_configs')
    .insert({
      tenant,
      config_id: targetConfigId,
      hourly_rate: normalizeNumeric(configuration.custom_rate) ?? 0,
      minimum_billable_time: hourlyConfig?.minimum_billable_time ?? 15,
      round_up_to_nearest: hourlyConfig?.round_up_to_nearest ?? 15,
      created_at: trx.fn.now(),
      updated_at: trx.fn.now(),
    })
    .onConflict(['tenant', 'config_id'])
    .merge({
      hourly_rate: normalizeNumeric(configuration.custom_rate) ?? 0,
      updated_at: trx.fn.now(),
    });
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
  targetConfigId: string,
  configuration: TemplateServiceConfigurationRow
) {
  const usageConfig = await trx<TemplateUsageConfigRow>('contract_template_line_service_usage_config')
    .where('tenant', tenant)
    .where('config_id', sourceConfigId)
    .first('unit_of_measure', 'enable_tiered_pricing', 'minimum_usage', 'base_rate');

  await trx('contract_line_service_usage_config')
    .insert({
      tenant,
      config_id: targetConfigId,
      unit_of_measure: usageConfig?.unit_of_measure ?? 'unit',
      enable_tiered_pricing: Boolean(usageConfig?.enable_tiered_pricing),
      minimum_usage: usageConfig?.minimum_usage ?? 0,
      base_rate: normalizeNumeric(configuration.custom_rate ?? usageConfig?.base_rate),
      created_at: trx.fn.now(),
      updated_at: trx.fn.now(),
    })
    .onConflict(['tenant', 'config_id'])
    .merge({
      unit_of_measure: usageConfig?.unit_of_measure ?? 'unit',
      enable_tiered_pricing: Boolean(usageConfig?.enable_tiered_pricing),
      minimum_usage: usageConfig?.minimum_usage ?? 0,
      base_rate: normalizeNumeric(configuration.custom_rate ?? usageConfig?.base_rate),
      updated_at: trx.fn.now(),
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

  const templateLine = await trx<CustomRateRow>('contract_template_lines')
    .where('tenant', tenant)
    .where('template_id', templateContractId)
    .where('template_line_id', templateContractLineId)
    .first('custom_rate');

  if (templateLine && templateLine.custom_rate != null) {
    return normalizeNumeric(templateLine.custom_rate);
  }

  return null;
}
