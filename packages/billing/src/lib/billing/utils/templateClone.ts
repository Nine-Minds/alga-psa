import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import type { IContractTemplateLine } from '@alga-psa/types';
import { cloneTemplateLinePools } from '@alga-psa/shared/billingClients/templateClone';

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

  const templateLine = await tenantDb(trx, tenant).table('contract_template_lines')
    .where('template_line_id', templateContractLineId)
    .first();

  if (!templateLine) {
    throw new Error(`Template contract line ${templateContractLineId} not found`);
  }

  // Clone services from template to contract_line_services
  const hasTemplatePools = await cloneTemplateLinePools(trx, tenant, templateContractLineId, targetContractLineId);
  await cloneServices(trx, tenant, templateContractLineId, targetContractLineId, hasTemplatePools);

  // Resolve the custom rate to apply
  const templateCustomRate = await resolveTemplateCustomRate(
    trx,
    tenant,
    templateContractId,
    templateContractLineId
  );

  const appliedCustomRate = overrideRate ?? templateCustomRate;

  // Update the contract_line's custom_rate directly (no separate pricing table needed)
  const templateInvoiceText = (templateLine as { invoice_line_description?: string | null })
    .invoice_line_description ?? null;
  if (appliedCustomRate !== null || templateInvoiceText !== null) {
    await tenantDb(trx, tenant).table('contract_lines')
      .where({ contract_line_id: targetContractLineId })
      .update({
        ...(appliedCustomRate !== null ? { custom_rate: appliedCustomRate } : {}),
        invoice_line_description: templateInvoiceText,
        updated_at: trx.fn.now()
      });
  }

  return { appliedCustomRate };
}

/** Copy template default discounts into one client-contract-owned definition set. */
export async function cloneTemplateDefaultDiscounts(
  trx: Knex.Transaction,
  options: { tenant: string; templateId: string; clientContractId: string; clientId: string; lineIdMap?: Record<string, string> },
): Promise<void> {
  const { tenant, templateId, clientContractId, clientId, lineIdMap = {} } = options;
  const template = await tenantDb(trx, tenant).table('contract_templates')
    .where({ template_id: templateId }).first('template_metadata');
  const metadata = typeof template?.template_metadata === 'string'
    ? JSON.parse(template.template_metadata)
    : template?.template_metadata;
  const definitions = Array.isArray(metadata?.default_discounts) ? metadata.default_discounts : [];
  if (!definitions.length) return;

  // The line population workflow can be retried. A client-contract gets one
  // independent copy set, never duplicate rows on a retry.
  const alreadyCopied = await tenantDb(trx, tenant).table('contract_discount_assignments')
    .where({ client_contract_id: clientContractId }).first('assignment_id');
  if (alreadyCopied) return;

  for (const definition of definitions) {
    if (!definition || typeof definition.discount_name !== 'string'
      || !['fixed', 'percentage'].includes(definition.discount_type)
      || (definition.scope != null && !['contract', 'line', 'service'].includes(definition.scope))
      || !Number.isFinite(Number(definition.value))
      || Number(definition.value) <= 0
      || (definition.discount_type === 'percentage' && Number(definition.value) > 100)
      || !/^\d{4}-\d{2}-\d{2}$/.test(String(definition.start_date ?? ''))
      || (definition.end_date && !/^\d{4}-\d{2}-\d{2}$/.test(String(definition.end_date)))) {
      throw new Error('Template default discount has invalid required fields.');
    }
    const discountId = uuidv4();
    const scope = ['service', 'line'].includes(definition.scope) ? definition.scope : 'contract';
    if (scope === 'service' && typeof definition.scope_service_id !== 'string') throw new Error('Template service-scoped discount is missing its service.');
    if (scope === 'line' && typeof definition.contract_line_id !== 'string') throw new Error('Template line-scoped discount is missing its template line.');
    await tenantDb(trx, tenant).table('discounts').insert({
      tenant,
      discount_id: discountId,
      discount_name: definition.discount_name.trim(),
      discount_type: definition.discount_type,
      value: definition.discount_type === 'percentage'
        ? Math.round((Number(definition.value) / 100) * 1e4) / 1e4
        : Math.round(Number(definition.value) * 100) / 100,
      start_date: `${definition.start_date}T00:00:00.000Z`,
      end_date: definition.end_date ? `${definition.end_date}T00:00:00.000Z` : null,
      is_active: definition.is_active !== false,
      scope,
      scope_service_id: scope === 'service' ? definition.scope_service_id : null,
      applies_to_item_id: null,
      priority: definition.priority ?? null,
      created_at: trx.fn.now(),
      updated_at: trx.fn.now(),
    });
    if (scope === 'line') {
      const targetLineId = lineIdMap[definition.contract_line_id] ?? definition.contract_line_id;
      if (!targetLineId || !lineIdMap[definition.contract_line_id]) throw new Error('Template line-scoped discount could not be mapped to a client contract line.');
      await tenantDb(trx, tenant).table('contract_line_discounts').insert({
        tenant, discount_id: discountId, contract_line_id: targetLineId, client_id: clientId,
      });
    } else {
      await tenantDb(trx, tenant).table('contract_discount_assignments').insert({
        tenant, assignment_id: uuidv4(), client_contract_id: clientContractId,
        discount_id: discountId, created_at: trx.fn.now(),
      });
    }
  }
}

async function cloneServices(
  trx: Knex.Transaction,
  tenant: string,
  templateContractLineId: string,
  contractLineId: string,
  hasTemplatePools = false
) {
  type TemplateServiceRow = {
    service_id: string;
    quantity: number | null;
    custom_rate: number | string | null;
  };

  const services = await tenantDb(trx, tenant).table('contract_template_line_services')
    .where('template_line_id', templateContractLineId)
    .select('service_id', 'quantity', 'custom_rate');

  for (const service of services) {
    // Insert into contract_line_services
    await tenantDb(trx, tenant).table('contract_line_services')
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
        updated_at: new Date().toISOString()
      });

    await cloneServiceConfiguration(
      trx,
      tenant,
      templateContractLineId,
      contractLineId,
      service.service_id,
      hasTemplatePools
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
  serviceId: string,
  hasTemplatePools = false
) {
  const configurations = await tenantDb(trx, tenant).table('contract_template_line_service_configuration')
    .where('template_line_id', templateContractLineId)
    .where('service_id', serviceId)
    .select('config_id', 'configuration_type', 'custom_rate', 'quantity');

  for (const configuration of configurations) {
    const newConfigId = uuidv4();

    // Insert into contract_line_service_configuration
    await tenantDb(trx, tenant).table('contract_line_service_configuration').insert({
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
  const bucketConfig = await tenantDb(trx, tenant).table('contract_template_line_service_bucket_config')
    .where('config_id', sourceConfigId)
    .first('total_minutes', 'billing_period', 'overage_rate', 'allow_rollover');

  if (!bucketConfig) return;

  // Weighted-burn model: clone into the line-owned pool tables (single-member
  // 1x pool) rather than the frozen legacy per-service bucket config.
  await tenantDb(trx, tenant).table('contract_line_buckets').insert({
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
  await tenantDb(trx, tenant).table('contract_line_bucket_services').insert({
    tenant,
    bucket_id: targetConfigId,
    service_id: serviceId,
    contract_line_id: contractLineId,
    burn_multiplier: 1,
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
  const fixedConfig = await tenantDb(trx, tenant).table('contract_template_line_service_fixed_config')
    .where('config_id', sourceConfigId)
    .first('base_rate');

  if (!fixedConfig) return;

  await tenantDb(trx, tenant).table('contract_line_service_fixed_config').insert({
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
  const hourlyConfig = await tenantDb(trx, tenant).table('contract_template_line_service_hourly_config')
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

  await tenantDb(trx, tenant).table('contract_line_service_hourly_config')
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
      updated_at: new Date().toISOString(),
    });

  await tenantDb(trx, tenant).table('contract_line_service_hourly_configs')
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
      updated_at: new Date().toISOString(),
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
  const usageConfig = await tenantDb(trx, tenant).table('contract_template_line_service_usage_config')
    .where('config_id', sourceConfigId)
    .first('unit_of_measure', 'enable_tiered_pricing', 'minimum_usage', 'base_rate');

  await tenantDb(trx, tenant).table('contract_line_service_usage_config')
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
      updated_at: new Date().toISOString(),
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

  const templateLine = await tenantDb(trx, tenant).table('contract_template_lines')
    .where('template_id', templateContractId)
    .where('template_line_id', templateContractLineId)
    .first('custom_rate');

  if (templateLine && templateLine.custom_rate != null) {
    return normalizeNumeric(templateLine.custom_rate);
  }

  return null;
}
