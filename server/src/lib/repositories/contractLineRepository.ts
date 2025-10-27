import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { IContractLine } from 'server/src/interfaces/billing.interfaces';
import { IContractLineMapping } from 'server/src/interfaces/contract.interfaces';

export type DetailedContractLine = IContractLineMapping & {
  contract_line_name?: string;
  contract_line_type?: string;
  billing_frequency?: string;
  rate?: number | null;
  enable_proration?: boolean;
  billing_cycle_alignment?: 'start' | 'end' | 'prorated';
};

type TenantScopedKnex = Knex | Knex.Transaction;

async function isTemplateContract(knex: TenantScopedKnex, tenant: string, contractId: string): Promise<boolean> {
  const record = await knex('contract_templates')
    .where({ tenant, template_id: contractId })
    .first('template_id');

  return Boolean(record);
}

function mapContractLineRow(row: any): IContractLineMapping {
  return {
    tenant: row.tenant,
    contract_id: row.contract_id,
    contract_line_id: row.contract_line_id,
    display_order: row.display_order ?? 0,
    custom_rate: row.custom_rate ?? null,
    billing_timing: row.billing_timing ?? 'arrears',
    created_at: row.created_at,
  };
}

export async function fetchContractLineMappings(
  knex: TenantScopedKnex,
  tenant: string,
  contractId: string
): Promise<IContractLineMapping[]> {
  const template = await isTemplateContract(knex, tenant, contractId);

  if (template) {
    const rows = await knex('contract_template_lines')
      .where({ tenant, template_id: contractId })
      .orderBy('display_order', 'asc')
      .select([
        'tenant',
        'template_id as contract_id',
        'template_line_id as contract_line_id',
        'display_order',
        'custom_rate',
        'billing_timing',
        'created_at',
      ]);
    return rows.map(mapContractLineRow);
  }

  const rows = await knex('contract_lines')
    .where({ tenant, contract_id: contractId })
    .orderBy('display_order', 'asc')
    .select([
      'tenant',
      'contract_id',
      'contract_line_id',
      'display_order',
      'custom_rate',
      'billing_timing',
      'created_at',
    ]);
  return rows.map(mapContractLineRow);
}

export async function fetchDetailedContractLines(
  knex: TenantScopedKnex,
  tenant: string,
  contractId: string
): Promise<DetailedContractLine[]> {
  const template = await isTemplateContract(knex, tenant, contractId);

  if (template) {
    const rows = await knex('contract_template_lines as lines')
      .leftJoin('contract_template_line_terms as terms', function joinTemplateTerms() {
        this.on('terms.template_line_id', '=', 'lines.template_line_id').andOn('terms.tenant', '=', 'lines.tenant');
      })
      .leftJoin('contract_template_line_fixed_config as fixed', function joinTemplateFixed() {
        this.on('fixed.template_line_id', '=', 'lines.template_line_id').andOn('fixed.tenant', '=', 'lines.tenant');
      })
      .where({ 'lines.template_id': contractId, 'lines.tenant': tenant })
      .select([
        'lines.tenant',
        'lines.template_id as contract_id',
        'lines.template_line_id as contract_line_id',
        'lines.display_order',
        'lines.custom_rate',
        'lines.billing_timing',
        'lines.created_at',
        'lines.template_line_name as contract_line_name',
        'lines.line_type as contract_line_type',
        'lines.billing_frequency',
        'terms.billing_timing as terms_billing_timing',
        'fixed.base_rate as default_rate',
        'fixed.enable_proration as template_enable_proration',
        'fixed.billing_cycle_alignment as template_billing_cycle_alignment',
      ])
      .orderBy('lines.display_order', 'asc');

    return rows.map((row: any) => ({
      ...mapContractLineRow({
        ...row,
        custom_rate:
          row.custom_rate ?? (row.default_rate != null ? Number(row.default_rate) : null),
        billing_timing: row.billing_timing ?? row.terms_billing_timing ?? 'arrears',
      }),
      contract_line_name: row.contract_line_name,
      contract_line_type: row.contract_line_type,
      billing_frequency: row.billing_frequency,
      rate:
        row.custom_rate !== undefined && row.custom_rate !== null
          ? Number(row.custom_rate)
          : row.default_rate != null
            ? Number(row.default_rate)
            : null,
      enable_proration: row.template_enable_proration ?? false,
      billing_cycle_alignment: (row.template_billing_cycle_alignment ?? 'start') as
        | 'start'
        | 'end'
        | 'prorated',
    }));
  }

  const rows = await knex('contract_lines as cl')
    .where({ 'cl.contract_id': contractId, 'cl.tenant': tenant })
    .select([
      'cl.tenant',
      'cl.contract_id',
      'cl.contract_line_id',
      'cl.display_order',
      'cl.custom_rate',
      'cl.billing_timing',
      'cl.created_at',
      'cl.contract_line_name',
      'cl.contract_line_type',
      'cl.billing_frequency',
      'cl.enable_proration',
      'cl.billing_cycle_alignment',
    ])
    .orderBy('cl.display_order', 'asc');

  return rows.map((row: any) => ({
    ...mapContractLineRow({
      ...row,
      custom_rate: row.custom_rate ?? null,
      billing_timing: row.billing_timing ?? 'arrears',
    }),
    contract_line_name: row.contract_line_name,
    contract_line_type: row.contract_line_type,
    billing_frequency: row.billing_frequency,
    rate: row.custom_rate !== undefined && row.custom_rate !== null ? Number(row.custom_rate) : null,
    enable_proration: row.enable_proration ?? false,
    billing_cycle_alignment: row.billing_cycle_alignment ?? 'start',
  }));
}

export async function isContractLineAttached(
  knex: TenantScopedKnex,
  tenant: string,
  contractId: string,
  contractLineId: string
): Promise<boolean> {
  const template = await isTemplateContract(knex, tenant, contractId);

  if (template) {
    const record = await knex('contract_template_lines')
      .where({ tenant, template_id: contractId, template_line_id: contractLineId })
      .first('template_line_id');
    return Boolean(record);
  }

  const record = await knex('contract_lines')
    .where({ tenant, contract_id: contractId, contract_line_id: contractLineId })
    .first('contract_line_id');
  return Boolean(record);
}

export async function ensureTemplateLineSnapshot(
  knex: TenantScopedKnex,
  tenant: string,
  templateId: string,
  contractLineId: string,
  customRate?: number
): Promise<string> {
  const templateLine = await knex('contract_template_lines')
    .where({ tenant, template_id: templateId, template_line_id: contractLineId })
    .first();

  if (templateLine) {
    await knex('contract_template_lines')
      .where({ tenant, template_id: templateId, template_line_id: contractLineId })
      .update({
        custom_rate: customRate ?? templateLine.custom_rate ?? null,
        updated_at: knex.fn.now(),
      });
    return contractLineId;
  }

  const baseLine = await knex('contract_lines')
    .where({ tenant, contract_line_id: contractLineId })
    .first();

  if (!baseLine) {
    throw new Error(`Base contract line ${contractLineId} not found for template snapshot`);
  }

  const now = knex.fn.now();
  const existingTemplateLine = await knex('contract_template_lines')
    .where({ tenant, template_line_id: contractLineId })
    .first();

  const targetTemplateLineId = existingTemplateLine ? uuidv4() : contractLineId;

  await knex('contract_template_lines').insert({
    tenant,
    template_line_id: targetTemplateLineId,
    template_id: templateId,
    template_line_name: baseLine.contract_line_name,
    description: baseLine.description ?? null,
    billing_frequency: baseLine.billing_frequency,
    line_type: baseLine.contract_line_type ?? 'Fixed',
    service_category: baseLine.service_category ?? null,
    is_active: baseLine.is_active ?? true,
    enable_overtime: baseLine.enable_overtime ?? false,
    overtime_rate: baseLine.overtime_rate ?? null,
    overtime_threshold: baseLine.overtime_threshold ?? null,
    enable_after_hours_rate: baseLine.enable_after_hours_rate ?? false,
    after_hours_multiplier: baseLine.after_hours_multiplier ?? null,
    minimum_billable_time: null,
    round_up_to_nearest: null,
    created_at: baseLine.created_at ?? now,
    updated_at: now,
    custom_rate: customRate ?? baseLine.custom_rate ?? null,
    display_order: baseLine.display_order ?? 0,
    billing_timing: baseLine.billing_timing ?? 'arrears',
  });

  return targetTemplateLineId;
}

async function cloneTemplateLineToContract(
  trx: TenantScopedKnex,
  tenant: string,
  contractId: string,
  templateLineId: string,
  customRate?: number
): Promise<string> {
  const templateLine = await trx('contract_template_lines')
    .where({ tenant, template_line_id: templateLineId })
    .first();

  if (!templateLine) {
    throw new Error(`Template contract line ${templateLineId} not found`);
  }

  const templateFixedConfig = await trx('contract_template_line_fixed_config')
    .where({ tenant, template_line_id: templateLineId })
    .first();

  const now = trx.fn.now();
  const newContractLineId = uuidv4();
  const effectiveRate =
    customRate ??
    templateLine.custom_rate ??
    (templateFixedConfig?.base_rate != null ? Number(templateFixedConfig.base_rate) : null);

  await trx('contract_lines').insert({
    tenant,
    contract_line_id: newContractLineId,
    contract_id: contractId,
    contract_line_name: templateLine.template_line_name,
    description: templateLine.description ?? null,
    billing_frequency: templateLine.billing_frequency,
    is_custom: false,
    contract_line_type: templateLine.line_type ?? 'Fixed',
    service_category: templateLine.service_category ?? null,
    is_active: templateLine.is_active ?? true,
    enable_overtime: templateLine.enable_overtime ?? false,
    overtime_rate: templateLine.overtime_rate ?? null,
    overtime_threshold: templateLine.overtime_threshold ?? null,
    enable_after_hours_rate: templateLine.enable_after_hours_rate ?? false,
    after_hours_multiplier: templateLine.after_hours_multiplier ?? null,
    created_at: now,
    updated_at: now,
    is_template: false,
    custom_rate: effectiveRate,
    display_order: templateLine.display_order ?? 0,
    billing_timing: templateLine.billing_timing ?? 'arrears',
    enable_proration: templateFixedConfig?.enable_proration ?? false,
    billing_cycle_alignment: templateFixedConfig?.billing_cycle_alignment ?? 'start',
  });

  const templateTerms = await trx('contract_template_line_terms')
    .where({ tenant, template_line_id: templateLineId })
    .first();

  if (templateTerms) {
    await trx('contract_line_template_terms')
      .insert({
        tenant,
        contract_line_id: newContractLineId,
        billing_frequency: templateTerms.billing_frequency ?? templateLine.billing_frequency ?? null,
        enable_overtime: templateTerms.enable_overtime ?? templateLine.enable_overtime ?? false,
        overtime_rate: templateTerms.overtime_rate ?? templateLine.overtime_rate ?? null,
        overtime_threshold: templateTerms.overtime_threshold ?? templateLine.overtime_threshold ?? null,
        enable_after_hours_rate: templateTerms.enable_after_hours_rate ?? templateLine.enable_after_hours_rate ?? false,
        after_hours_multiplier: templateTerms.after_hours_multiplier ?? templateLine.after_hours_multiplier ?? null,
        minimum_billable_time: templateTerms.minimum_billable_time ?? null,
        round_up_to_nearest: templateTerms.round_up_to_nearest ?? null,
        created_at: templateTerms.created_at ?? now,
        updated_at: now,
      })
      .onConflict(['tenant', 'contract_line_id'])
      .merge({
        billing_frequency: templateTerms.billing_frequency ?? templateLine.billing_frequency ?? null,
        enable_overtime: templateTerms.enable_overtime ?? templateLine.enable_overtime ?? false,
        overtime_rate: templateTerms.overtime_rate ?? templateLine.overtime_rate ?? null,
        overtime_threshold: templateTerms.overtime_threshold ?? templateLine.overtime_threshold ?? null,
        enable_after_hours_rate: templateTerms.enable_after_hours_rate ?? templateLine.enable_after_hours_rate ?? false,
        after_hours_multiplier: templateTerms.after_hours_multiplier ?? templateLine.after_hours_multiplier ?? null,
        minimum_billable_time: templateTerms.minimum_billable_time ?? null,
        round_up_to_nearest: templateTerms.round_up_to_nearest ?? null,
        updated_at: now,
      });
  }

  const templateServices = await trx('contract_template_line_services')
    .where({ tenant, template_line_id: templateLineId });

  for (const service of templateServices) {
    await trx('contract_line_services')
      .insert({
        tenant,
        contract_line_id: newContractLineId,
        service_id: service.service_id,
        quantity: service.quantity ?? null,
        custom_rate: service.custom_rate ?? null,
      })
      .onConflict(['tenant', 'service_id', 'contract_line_id'])
      .merge({
        quantity: service.quantity ?? null,
        custom_rate: service.custom_rate ?? null,
      });

    const configurations = await trx('contract_template_line_service_configuration')
      .where({ tenant, template_line_id: templateLineId, service_id: service.service_id });

    for (const configuration of configurations) {
      const newConfigId = uuidv4();

      await trx('contract_line_service_configuration').insert({
        tenant,
        config_id: newConfigId,
        contract_line_id: newContractLineId,
        service_id: service.service_id,
        configuration_type: configuration.configuration_type,
        custom_rate: configuration.custom_rate ?? null,
        quantity: configuration.quantity ?? null,
        created_at: configuration.created_at ?? now,
        updated_at: now,
      });

      const bucketConfig = await trx('contract_template_line_service_bucket_config')
        .where({ tenant, config_id: configuration.config_id })
        .first();

      if (bucketConfig) {
        await trx('contract_line_service_bucket_config').insert({
          tenant,
          config_id: newConfigId,
          total_minutes: bucketConfig.total_minutes,
          billing_period: bucketConfig.billing_period,
          overage_rate: bucketConfig.overage_rate ?? 0,
          allow_rollover: bucketConfig.allow_rollover,
          created_at: bucketConfig.created_at ?? now,
          updated_at: now,
        });
      }

      const hourlyConfig = await trx('contract_template_line_service_hourly_config')
        .where({ tenant, config_id: configuration.config_id })
        .first();

      if (hourlyConfig) {
        await trx('contract_line_service_hourly_config').insert({
          tenant,
          config_id: newConfigId,
          minimum_billable_time: hourlyConfig.minimum_billable_time,
          round_up_to_nearest: hourlyConfig.round_up_to_nearest,
          enable_overtime: hourlyConfig.enable_overtime,
          overtime_rate: hourlyConfig.overtime_rate ?? null,
          overtime_threshold: hourlyConfig.overtime_threshold ?? null,
          enable_after_hours_rate: hourlyConfig.enable_after_hours_rate,
          after_hours_multiplier: hourlyConfig.after_hours_multiplier ?? null,
          created_at: hourlyConfig.created_at ?? now,
          updated_at: now,
        });
      }

      const usageConfig = await trx('contract_template_line_service_usage_config')
        .where({ tenant, config_id: configuration.config_id })
        .first();

      if (usageConfig) {
        await trx('contract_line_service_usage_config').insert({
          tenant,
          config_id: newConfigId,
          unit_of_measure: usageConfig.unit_of_measure,
          enable_tiered_pricing: usageConfig.enable_tiered_pricing,
          created_at: usageConfig.created_at ?? now,
          updated_at: now,
        });
      }
    }
  }

  const templateDefaults = await trx('contract_template_line_defaults')
    .where({ tenant, template_line_id: templateLineId });

  for (const def of templateDefaults) {
    await trx('contract_line_service_defaults').insert({
      tenant,
      default_id: def.default_id,
      contract_line_id: newContractLineId,
      service_id: def.service_id,
      line_type: def.line_type ?? null,
      default_tax_behavior: def.default_tax_behavior ?? null,
      metadata: def.metadata ?? null,
      created_at: def.created_at ?? now,
      updated_at: now,
    });
  }

  return newContractLineId;
}

export async function addContractLine(
  trx: TenantScopedKnex,
  tenant: string,
  contractId: string,
  contractLineId: string,
  customRate?: number
): Promise<IContractLineMapping> {
  const template = await isTemplateContract(trx, tenant, contractId);

  if (template) {
    const effectiveLineId = await ensureTemplateLineSnapshot(trx, tenant, contractId, contractLineId, customRate);

    const row = await trx('contract_template_lines')
      .where({ tenant, template_id: contractId, template_line_id: effectiveLineId })
      .first([
        'tenant',
        'template_id as contract_id',
        'template_line_id as contract_line_id',
        'display_order',
        'custom_rate',
        'billing_timing',
        'created_at',
      ]);

    return mapContractLineRow(row);
  }

  const newContractLineId = await cloneTemplateLineToContract(trx, tenant, contractId, contractLineId, customRate);

  const row = await trx('contract_lines')
    .where({ tenant, contract_id: contractId, contract_line_id: newContractLineId })
    .first([
      'tenant',
      'contract_id',
      'contract_line_id',
      'display_order',
      'custom_rate',
      'billing_timing',
      'created_at',
    ]);

  return mapContractLineRow(row);
}

export async function removeContractLine(
  knex: TenantScopedKnex,
  tenant: string,
  contractId: string,
  contractLineId: string
): Promise<void> {
  const template = await isTemplateContract(knex, tenant, contractId);

  if (template) {
    await knex('contract_template_lines')
      .where({ tenant, template_id: contractId, template_line_id: contractLineId })
      .delete();
    return;
  }

  await knex('contract_lines')
    .where({ tenant, contract_id: contractId, contract_line_id: contractLineId })
    .delete();
}

export async function updateContractLine(
  knex: TenantScopedKnex,
  tenant: string,
  contractId: string,
  contractLineId: string,
  updateData: Partial<IContractLineMapping>
): Promise<IContractLineMapping> {
  const template = await isTemplateContract(knex, tenant, contractId);
  const payload = { ...updateData };

  if (payload.custom_rate === undefined) {
    payload.custom_rate = null;
  }

  if (template) {
    await knex('contract_template_lines')
      .where({ tenant, template_id: contractId, template_line_id: contractLineId })
      .update({
        custom_rate: payload.custom_rate ?? null,
        display_order: payload.display_order ?? undefined,
        billing_timing: payload.billing_timing ?? undefined,
        updated_at: knex.fn.now(),
      });

    const row = await knex('contract_template_lines')
      .where({ tenant, template_id: contractId, template_line_id: contractLineId })
      .first([
        'tenant',
        'template_id as contract_id',
        'template_line_id as contract_line_id',
        'display_order',
        'custom_rate',
        'billing_timing',
        'created_at',
      ]);
    return mapContractLineRow(row);
  }

  await knex('contract_lines')
    .where({ tenant, contract_id: contractId, contract_line_id: contractLineId })
    .update({
      custom_rate: payload.custom_rate ?? null,
      display_order: payload.display_order ?? undefined,
      billing_timing: payload.billing_timing ?? undefined,
      updated_at: knex.fn.now(),
    });

  const row = await knex('contract_lines')
    .where({ tenant, contract_id: contractId, contract_line_id: contractLineId })
    .first([
      'tenant',
      'contract_id',
      'contract_line_id',
      'display_order',
      'custom_rate',
      'billing_timing',
      'created_at',
    ]);
  return mapContractLineRow(row);
}

export async function fetchContractLineById(
  knex: TenantScopedKnex,
  tenant: string,
  contractLineId: string
): Promise<IContractLine | undefined> {
  return knex('contract_lines').where({ tenant, contract_line_id: contractLineId }).first();
}

export async function updateContractLineRate(
  knex: TenantScopedKnex,
  tenant: string,
  contractId: string,
  contractLineId: string,
  rate: number | null,
  billingTiming?: 'arrears' | 'advance'
): Promise<void> {
  const now = knex.fn.now();
  const template = await isTemplateContract(knex, tenant, contractId);

  if (template) {
    await knex('contract_template_lines')
      .where({ tenant, template_id: contractId, template_line_id: contractLineId })
      .update({
        custom_rate: rate,
        billing_timing: billingTiming ?? undefined,
        updated_at: now,
      });
    return;
  }

  await knex('contract_lines')
    .where({ tenant, contract_id: contractId, contract_line_id: contractLineId })
    .update({
      custom_rate: rate,
      billing_timing: billingTiming ?? undefined,
      updated_at: now,
    });
}
