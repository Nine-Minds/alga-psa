
import { resolveUnitOfMeasure, withUnitCode } from '@alga-psa/core/unitOfMeasure';
import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import type { IContractTemplateLine } from '@alga-psa/types';
import { cloneTemplateLinePools, cloneTemplateServiceFixedConfig } from '@alga-psa/shared/billingClients/templateClone';

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
  const db = tenantDb(trx, tenant);
  const template = await db.table('contract_templates')
    .where({ template_id: templateId }).forUpdate().first('template_metadata');
  const metadata = typeof template?.template_metadata === 'string'
    ? JSON.parse(template.template_metadata)
    : template?.template_metadata;
  type TemplateDefaultDiscount = {
    template_discount_key?: string; discount_name?: string; discount_type?: string; value?: number | string;
    scope?: string | null; start_date?: string; end_date?: string | null; is_active?: boolean;
    scope_service_id?: string; contract_line_id?: string; priority?: number | null;
  };
  let definitions: TemplateDefaultDiscount[] = Array.isArray(metadata?.default_discounts) ? metadata.default_discounts : [];
  if (!definitions.length) return;
  if (definitions.some((definition) => !definition?.template_discount_key)) {
    definitions = definitions.map((definition) => ({
      ...definition, template_discount_key: definition.template_discount_key || uuidv4(),
    }));
    await db.table('contract_templates').where({ template_id: templateId }).update({
      template_metadata: { ...metadata, default_discounts: definitions }, updated_at: trx.fn.now(),
    });
  }

  // Serialize retries for this assignment, then track every source term
  // independently. An unrelated discount or a line-only copy is not evidence
  // that the template copy completed.
  const owner = await db.table('client_contracts').where({ client_contract_id: clientContractId }).forUpdate().first('client_contract_id');
  if (!owner) throw new Error('The client contract for template discount copying no longer exists.');

  for (const definition of definitions) {
    if (!definition || typeof definition.discount_name !== 'string'
      || typeof definition.discount_type !== 'string'
      || !['fixed', 'percentage'].includes(definition.discount_type)
      || (definition.scope != null && !['contract', 'line', 'service'].includes(definition.scope))
      || !Number.isFinite(Number(definition.value))
      || Number(definition.value) <= 0
      || (definition.discount_type === 'percentage' && Number(definition.value) > 100)
      || !/^\d{4}-\d{2}-\d{2}$/.test(String(definition.start_date ?? ''))
      || (definition.end_date && !/^\d{4}-\d{2}-\d{2}$/.test(String(definition.end_date)))) {
      throw new Error('Template default discount has invalid required fields.');
    }
    const discountType = definition.discount_type as 'fixed' | 'percentage';
    const startDate = String(definition.start_date);
    const templateDiscountKey = String(definition.template_discount_key);
    const copied = await db.table('contract_template_discount_copies')
      .where({ client_contract_id: clientContractId, template_discount_key: templateDiscountKey })
      .first('discount_id');
    if (copied) continue;
    const discountId = uuidv4();
    const scope = definition.scope === 'service' || definition.scope === 'line' ? definition.scope : 'contract';
    if (scope === 'service' && typeof definition.scope_service_id !== 'string') throw new Error('Template service-scoped discount is missing its service.');
    if (scope === 'line' && typeof definition.contract_line_id !== 'string') throw new Error('Template line-scoped discount is missing its template line.');
    await tenantDb(trx, tenant).table('discounts').insert({
      tenant,
      discount_id: discountId,
      discount_name: definition.discount_name.trim(),
      discount_type: discountType,
      value: discountType === 'percentage'
        ? Math.round((Number(definition.value) / 100) * 1e4) / 1e4
        : Math.round(Number(definition.value) * 100) / 100,
      start_date: `${startDate}T00:00:00.000Z`,
      end_date: definition.end_date ? `${definition.end_date}T00:00:00.000Z` : null,
      is_active: definition.is_active !== false,
      scope,
      scope_service_id: scope === 'service' ? definition.scope_service_id as string : null,
      applies_to_item_id: null,
      priority: definition.priority ?? null,
      created_at: trx.fn.now(),
      updated_at: trx.fn.now(),
    });
    if (scope === 'line') {
      const templateLineId = definition.contract_line_id as string;
      const targetLineId = lineIdMap[templateLineId] ?? templateLineId;
      if (!targetLineId || !lineIdMap[templateLineId]) throw new Error('Template line-scoped discount could not be mapped to a client contract line.');
      await tenantDb(trx, tenant).table('contract_line_discounts').insert({
        tenant, discount_id: discountId, contract_line_id: targetLineId, client_id: clientId,
        client_contract_id: clientContractId,
      });
    } else {
      await tenantDb(trx, tenant).table('contract_discount_assignments').insert({
        tenant, assignment_id: uuidv4(), client_contract_id: clientContractId,
        discount_id: discountId, created_at: trx.fn.now(),
      });
    }
    await db.table('contract_template_discount_copies').insert({
      tenant, client_contract_id: clientContractId, template_discount_key: templateDiscountKey, discount_id: discountId,
    });
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
        custom_rate: normalizeNumeric(service.custom_rate)
      })
      .onConflict(['tenant', 'contract_line_id', 'service_id'])
      .merge({
        quantity: service.quantity,
        custom_rate: normalizeNumeric(service.custom_rate)
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
      await cloneTemplateServiceFixedConfig(trx, tenant, configuration.config_id, newConfigId);
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
    .first('unit_of_measure', 'unit_code', 'enable_tiered_pricing', 'minimum_usage', 'base_rate');

  const clonedUnit = withUnitCode({
    unit_of_measure: usageConfig?.unit_of_measure ?? resolveUnitOfMeasure({ fallback: 'C62' }).label,
    unit_code: usageConfig?.unit_code ?? null,
  });
  await tenantDb(trx, tenant).table('contract_line_service_usage_config')
    .insert({
      tenant,
      config_id: targetConfigId,
      ...clonedUnit,
      enable_tiered_pricing: Boolean(usageConfig?.enable_tiered_pricing),
      minimum_usage: usageConfig?.minimum_usage ?? 0,
      base_rate: normalizeNumeric(configuration.custom_rate ?? usageConfig?.base_rate),
      created_at: trx.fn.now(),
      updated_at: trx.fn.now(),
    })
    .onConflict(['tenant', 'config_id'])
    .merge({
      ...clonedUnit,
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
