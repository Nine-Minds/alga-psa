import type { Knex } from 'knex';
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

  const templateLine = await trx<IContractTemplateLine>('contract_template_lines')
    .where('tenant', tenant)
    .where('template_line_id', templateContractLineId)
    .first();

  if (!templateLine) {
    throw new Error(`Template contract line ${templateContractLineId} not found`);
  }

  await cloneServices(trx, tenant, templateContractLineId, contractLineId);

  const templateCustomRate = await resolveTemplateCustomRate(trx, tenant, templateContractId, templateContractLineId);
  const appliedCustomRate = overrideRate ?? templateCustomRate;

  if (appliedCustomRate !== null) {
    await trx('contract_lines')
      .where({ tenant, contract_line_id: contractLineId })
      .update({
        custom_rate: appliedCustomRate,
        updated_at: trx.fn.now()
      });
  }

  return { appliedCustomRate };
}

async function cloneServices(trx: Knex.Transaction, tenant: string, templateContractLineId: string, contractLineId: string) {
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

    await cloneServiceConfiguration(trx, tenant, templateContractLineId, contractLineId, service.service_id);
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

async function cloneBucketConfig(trx: Knex.Transaction, tenant: string, sourceConfigId: string, targetConfigId: string) {
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
  const hourlyConfig = await trx<TemplateHourlyConfigRow>('contract_template_line_service_hourly_config')
    .where('tenant', tenant)
    .where('config_id', sourceConfigId)
    .first('billing_period', 'hourly_rate', 'user_type_rates');

  if (!hourlyConfig) return;

  await trx('contract_line_service_hourly_config').insert({
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
  const usageConfig = await trx<TemplateUsageConfigRow>('contract_template_line_service_usage_config')
    .where('tenant', tenant)
    .where('config_id', sourceConfigId)
    .first('billing_period', 'unit_name', 'included_units', 'overage_rate');

  if (!usageConfig) return;

  await trx('contract_line_service_usage_config').insert({
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
  const fixedConfig = await trx('contract_template_line_service_fixed_config')
    .where('tenant', tenant)
    .where('config_id', sourceConfigId)
    .first();

  if (!fixedConfig) return;

  await trx('contract_line_service_fixed_config').insert({
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
  if (!templateContractId) return null;

  const row = await trx('contract_template_line_mappings')
    .where({ tenant, template_id: templateContractId, template_line_id: templateContractLineId })
    .first('custom_rate');

  return normalizeNumeric(row?.custom_rate);
}

