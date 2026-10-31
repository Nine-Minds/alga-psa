import type { Knex } from 'knex';
import { resolveUnitOfMeasure, withUnitCode } from '@alga-psa/core/unitOfMeasure';
import { tenantDb } from '@alga-psa/db';
import { v4 as uuidv4 } from 'uuid';
import type { IContractTemplateLine } from '@alga-psa/types';
import { legacyCloneAmountReader, type ResolvedTemplateAmounts } from './templateAmounts';
import { fixedMemberRateProvenance, resolveFixedMemberRatePair } from './fixedMemberRate';

// LEVERAGE: pattern template-clone-substrate — older, divergent template->contract clone (drops hourly/usage rates and fixed config detail). The faithful one is cloneTemplateLineToContract in packages/billing/src/repositories/contractLineRepository.ts (alga-2026-0002371).
interface CloneTemplateOptions {
  tenant: string;
  templateContractLineId: string;
  contractLineId: string;
  templateContractId?: string | null;
  overrideRate?: number | null;
  effectiveDate?: string | null;
  /**
   * The template's amounts resolved for the TARGET contract's currency
   * (`resolveTemplateAmountsForContract`). Every amount written by this clone
   * comes from here; no template amount column is copied, so an amount can never
   * cross currencies. Unset amounts stay unset (never rejected on this path).
   */
  amounts: ResolvedTemplateAmounts;
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
  const { tenant, templateContractLineId, contractLineId, overrideRate = null, amounts } = options;

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
  const reader = legacyCloneAmountReader(amounts, templateContractLineId);
  const hasTemplatePools = await cloneTemplateLinePools(
    trx,
    tenant,
    templateContractLineId,
    contractLineId,
    reader.poolOverageRates()
  );
  await cloneServices(trx, tenant, templateContractLineId, contractLineId, hasTemplatePools, reader);
  await cloneTemplateLinePrepaidBlock(trx, tenant, templateContractLineId, contractLineId);

  const appliedCustomRate = overrideRate ?? reader.lineRate();

  // A template rate is a clone-time snapshot source; a null one follows the
  // live catalog. Template edits stay provenance-only for live lines.
  await db.table('contract_lines')
    .where({ contract_line_id: contractLineId })
    .update({
      custom_rate: appliedCustomRate,
      rate_provenance: appliedCustomRate === null ? 'inherited' : 'custom',
      updated_at: trx.fn.now()
    });

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
  contractLineId: string,
  overageRateByTemplateBucketId?: Map<string, number | null>
): Promise<boolean> {
  const { hasPools } = await cloneTemplateLinePoolsDetailed(
    trx,
    tenant,
    templateContractLineId,
    contractLineId,
    overageRateByTemplateBucketId
  );
  return hasPools;
}

export interface ClonedTemplatePool {
  template_bucket_id: string;
  contract_bucket_id: string;
  bucket_name: string | null;
  /** The overage rate written to the contract pool (cents, 0 when unset). */
  overage_rate: number;
  /** True when a rate map was supplied and had no amount for this pool (stored as 0). */
  overage_unset: boolean;
}

/**
 * Pool clone that also reports what it wrote per pool.
 *
 * `overageRateByTemplateBucketId` (keyed by TEMPLATE pool id) is the currency-safe
 * source of pool overage: a missing or null entry means "no amount in the
 * contract currency", which is stored as 0 (the column is NOT NULL) and reported
 * via `overage_unset`. When the map is NOT passed the template column is copied
 * verbatim (legacy callers that have not resolved template amounts yet; they
 * must pass the map built from `resolveTemplateAmounts` to stay currency-safe).
 */
export async function cloneTemplateLinePoolsDetailed(
  trx: Knex | Knex.Transaction,
  tenant: string,
  templateContractLineId: string,
  contractLineId: string,
  overageRateByTemplateBucketId?: Map<string, number | null>
): Promise<{ hasPools: boolean; pools: ClonedTemplatePool[] }> {
  const db = tenantDb(trx, tenant);
  const templatePools = await db.table('contract_template_line_buckets')
    .where('template_line_id', templateContractLineId)
    .select('*');

  if (!templatePools || templatePools.length === 0) {
    return { hasPools: false, pools: [] };
  }

  const cloned: ClonedTemplatePool[] = [];
  for (const pool of templatePools) {
    const newBucketId = uuidv4();
    let overageRate: number;
    let overageUnset = false;
    if (overageRateByTemplateBucketId) {
      const mapped = overageRateByTemplateBucketId.get(pool.bucket_id);
      overageUnset = mapped === undefined || mapped === null;
      overageRate = overageUnset ? 0 : Number(mapped);
    } else {
      overageRate = normalizeNumeric(pool.overage_rate) ?? 0;
    }
    await db.table('contract_line_buckets').insert({
      tenant,
      bucket_id: newBucketId,
      contract_line_id: contractLineId,
      bucket_name: pool.bucket_name ?? null,
      total_minutes: pool.total_minutes,
      overage_rate: overageRate,
      allow_rollover: pool.allow_rollover,
      billing_period: pool.billing_period ?? 'monthly',
      after_hours_multiplier: pool.after_hours_multiplier ?? null,
      business_hours_schedule_id: pool.business_hours_schedule_id ?? null,
      covers_all_services: pool.covers_all_services,
      created_at: trx.fn.now(),
      updated_at: trx.fn.now(),
    });
    cloned.push({
      template_bucket_id: pool.bucket_id,
      contract_bucket_id: newBucketId,
      bucket_name: pool.bucket_name ?? null,
      overage_rate: overageRate,
      overage_unset: overageUnset,
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

  return { hasPools: true, pools: cloned };
}

type AmountReader = ReturnType<typeof legacyCloneAmountReader>;

const PREPAID_BLOCK_CONFIG_COLUMNS = [
  'issue_mode',
  'rollover_periods',
  'block_minutes',
  'block_price',
  'expiry_months',
  'trigger_on_exhaustion',
  'trigger_threshold_percent',
  'trigger_on_expiry',
  'trigger_on_renewal',
  'replenishment_tier',
] as const;

/**
 * Clone a template line's Prepaid Block config (contract_template_line_prepaid_blocks)
 * onto a live contract line (contract_line_prepaid_blocks). A Prepaid Block line is an
 * Hourly line plus this one overlay row, so every template clone path must call this
 * AFTER the line's services exist (the sold-as service must be one of them).
 *
 * `block_price` is minor units and is copied as-is, in the template's base currency:
 * prepaid block amounts are not part of a template's per-currency price sets yet, so
 * this is the one clone path that still carries a number across a currency mismatch.
 * A template without the row, or a non-Hourly line, copies nothing.
 *
 * Does NOT sync block issuances: callers that attach the line to an active client
 * contract run the prepaid issuance sync afterwards.
 *
 * Returns true when a config row was written.
 *
 * LEVERAGE: pattern template-pool-roundtrip — same rule as the pools above: this module
 * owns the prepaid block copy so every clone path stays in lockstep.
 */
export async function cloneTemplateLinePrepaidBlock(
  trx: Knex | Knex.Transaction,
  tenant: string,
  templateContractLineId: string,
  contractLineId: string
): Promise<boolean> {
  const db = tenantDb(trx, tenant);
  const templateConfig = await db.table('contract_template_line_prepaid_blocks')
    .where('template_line_id', templateContractLineId)
    .first();
  if (!templateConfig) {
    return false;
  }

  const targetLine = await db.table('contract_lines')
    .where('contract_line_id', contractLineId)
    .first('contract_line_type');
  if (!targetLine || targetLine.contract_line_type !== 'Hourly') {
    return false;
  }

  // The sold-as service must be one of the line's services; fall back to the first
  // template service (display order) when the template has none chosen or it is gone.
  const lineServiceIds: string[] = await db.table('contract_line_services')
    .where('contract_line_id', contractLineId)
    .pluck('service_id');
  const templateServiceOrder: string[] = await db.table('contract_template_line_services')
    .where('template_line_id', templateContractLineId)
    .orderBy('display_order', 'asc')
    .pluck('service_id');
  const firstCovered = templateServiceOrder.find((id) => lineServiceIds.includes(id)) ?? lineServiceIds[0] ?? null;
  const soldAs =
    templateConfig.sold_as_service_id && lineServiceIds.includes(templateConfig.sold_as_service_id)
      ? templateConfig.sold_as_service_id
      : firstCovered;

  const values: Record<string, unknown> = {};
  for (const column of PREPAID_BLOCK_CONFIG_COLUMNS) {
    values[column] = templateConfig[column] ?? null;
  }
  // Bound timestamp: Citus rejects non-IMMUTABLE functions in the DO UPDATE SET of distributed upserts.
  const now = new Date().toISOString();
  await db.table('contract_line_prepaid_blocks')
    .insert({
      tenant,
      contract_line_id: contractLineId,
      sold_as_service_id: soldAs,
      ...values,
      created_at: now,
      updated_at: now,
    })
    .onConflict(['tenant', 'contract_line_id'])
    .merge({ sold_as_service_id: soldAs, ...values, updated_at: now });
  return true;
}

/**
 * Contract -> template snapshot of a line's Prepaid Block config (the counterpart of
 * {@link cloneTemplateLinePrepaidBlock}); used by both ensureTemplateLineSnapshot copies.
 * Replaces any existing template config row so repeated snapshots stay in sync, and
 * removes a stale one when the line no longer carries a config.
 */
export async function snapshotContractLinePrepaidBlockToTemplateLine(
  trx: Knex | Knex.Transaction,
  tenant: string,
  contractLineId: string,
  templateLineId: string
): Promise<boolean> {
  const db = tenantDb(trx, tenant);
  const lineConfig = await db.table('contract_line_prepaid_blocks')
    .where('contract_line_id', contractLineId)
    .first();
  if (!lineConfig) {
    await db.table('contract_template_line_prepaid_blocks').where('template_line_id', templateLineId).delete();
    return false;
  }

  const values: Record<string, unknown> = {};
  for (const column of PREPAID_BLOCK_CONFIG_COLUMNS) {
    values[column] = lineConfig[column] ?? null;
  }
  const now = new Date().toISOString();
  await db.table('contract_template_line_prepaid_blocks')
    .insert({
      tenant,
      template_line_id: templateLineId,
      sold_as_service_id: lineConfig.sold_as_service_id ?? null,
      ...values,
      created_at: now,
      updated_at: now,
    })
    .onConflict(['tenant', 'template_line_id'])
    .merge({ sold_as_service_id: lineConfig.sold_as_service_id ?? null, ...values, updated_at: now });
  return true;
}

async function cloneServices(
  trx: Knex.Transaction,
  tenant: string,
  templateContractLineId: string,
  contractLineId: string,
  hasTemplatePools: boolean,
  reader: AmountReader
) {
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
    // The member rate is the resolved slot amount in the contract currency, never
    // the template's custom_rate column.
    const memberRate = reader.memberRate(service.service_id);
    // contract_line_services has no timestamp columns (see the other writers
    // in contractWizardActions/contractLinePresetActions).
    await db.table('contract_line_services')
      .insert({
        tenant,
        contract_line_id: contractLineId,
        service_id: service.service_id,
        quantity: service.quantity,
        custom_rate: memberRate
      })
      .onConflict(['tenant', 'contract_line_id', 'service_id'])
      .merge({
        quantity: service.quantity,
        custom_rate: memberRate
      });

    await cloneServiceConfiguration(trx, tenant, templateContractLineId, contractLineId, service.service_id, hasTemplatePools, reader);
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
  hasTemplatePools: boolean,
  reader: AmountReader
) {
  const db = tenantDb(trx, tenant);
  const memberRate = reader.memberRate(serviceId);
  const memberOvertimeRate = reader.memberOvertimeRate(serviceId);
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
      custom_rate: memberRate,
      quantity: configuration.quantity,
      created_at: trx.fn.now(),
      updated_at: trx.fn.now()
    });

    // When the template carries pool rows, the pools were already cloned in
    // full by cloneTemplateLinePools — cloning the legacy per-config bucket
    // here would mint a duplicate pool.
    if (configuration.configuration_type === 'Bucket' && !hasTemplatePools) {
      await cloneBucketConfig(trx, tenant, configuration.config_id, newConfigId, contractLineId, serviceId, reader.legacyBucketOverageRate(serviceId));
    }

    if (configuration.configuration_type === 'Hourly') {
      await cloneHourlyConfig(trx, tenant, configuration.config_id, newConfigId, memberRate, memberOvertimeRate);
    }

    if (configuration.configuration_type === 'Usage') {
      await cloneUsageConfig(trx, tenant, configuration.config_id, newConfigId, memberRate);
    }

    if (configuration.configuration_type === 'Fixed') {
      await cloneTemplateServiceFixedConfig(trx, tenant, configuration.config_id, newConfigId, memberRate);
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
  serviceId: string,
  overageRate: number | null
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
    overage_rate: overageRate ?? 0,
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

// LEVERAGE: friction template-clone-substrate — this hourly/usage config copy was written against
// columns the live template tables do not have (billing_period, hourly_rate, unit_name, ...) and threw
// on any hourly/usage template line. It now mirrors packages/billing/src/lib/billing/utils/templateClone.ts
// (the same duplicate) so both legacy clones can be proven currency-safe; a single layer should own it.
async function cloneHourlyConfig(
  trx: Knex.Transaction,
  tenant: string,
  sourceConfigId: string,
  targetConfigId: string,
  memberRate: number | null,
  memberOvertimeRate: number | null
) {
  const db = tenantDb(trx, tenant);
  const hourlyConfig = await db.table('contract_template_line_service_hourly_config')
    .where('config_id', sourceConfigId)
    .first(
      'minimum_billable_time',
      'round_up_to_nearest',
      'enable_overtime',
      'overtime_threshold',
      'enable_after_hours_rate',
      'after_hours_multiplier'
    );

  const minimumBillableTime = hourlyConfig?.minimum_billable_time ?? 15;
  const roundUpToNearest = hourlyConfig?.round_up_to_nearest ?? 15;

  await db.table('contract_line_service_hourly_config').insert({
    tenant,
    config_id: targetConfigId,
    minimum_billable_time: minimumBillableTime,
    round_up_to_nearest: roundUpToNearest,
    enable_overtime: Boolean(hourlyConfig?.enable_overtime),
    // The overtime RATE is an amount: only the resolved slot, never the template column.
    overtime_rate: memberOvertimeRate,
    overtime_threshold: hourlyConfig?.overtime_threshold ?? null,
    enable_after_hours_rate: Boolean(hourlyConfig?.enable_after_hours_rate),
    after_hours_multiplier: normalizeNumeric(hourlyConfig?.after_hours_multiplier),
    created_at: trx.fn.now(),
    updated_at: trx.fn.now()
  });

  await db.table('contract_line_service_hourly_configs').insert({
    tenant,
    config_id: targetConfigId,
    hourly_rate: memberRate ?? 0,
    minimum_billable_time: minimumBillableTime,
    round_up_to_nearest: roundUpToNearest,
    created_at: trx.fn.now(),
    updated_at: trx.fn.now()
  });
}

async function cloneUsageConfig(trx: Knex.Transaction, tenant: string, sourceConfigId: string, targetConfigId: string, memberRate: number | null) {
  const db = tenantDb(trx, tenant);
  const usageConfig = await db.table('contract_template_line_service_usage_config')
    .where('config_id', sourceConfigId)
    .first('unit_of_measure', 'unit_code', 'enable_tiered_pricing', 'minimum_usage');

  const clonedUnit = withUnitCode({
    unit_of_measure: usageConfig?.unit_of_measure ?? resolveUnitOfMeasure({ fallback: 'C62' }).label,
    unit_code: usageConfig?.unit_code ?? null,
  });
  await db.table('contract_line_service_usage_config').insert({
    tenant,
    config_id: targetConfigId,
    ...clonedUnit,
    enable_tiered_pricing: Boolean(usageConfig?.enable_tiered_pricing),
    minimum_usage: usageConfig?.minimum_usage ?? 0,
    base_rate: memberRate,
    created_at: trx.fn.now(),
    updated_at: trx.fn.now()
  });
}

/**
 * Copy a template service's fixed-config row (pricing basis + optional default
 * unit rate) onto the contract line's service configuration. Shared by every
 * template → contract copy path so a per-seat service can never silently
 * demote to a bundle allocation because one path forgot the row.
 *
 * Templates carry no provenance column: a stored template base_rate is an
 * intentional clone-time snapshot (`custom`); a null one follows the live
 * catalog in the contract's currency (`inherited`). Never copy a template-row
 * provenance verbatim.
 *
 * LEVERAGE: pattern template-pool-roundtrip — third template → contract copy
 * that must remember a template-side table (pools, fixed config); a single
 * "clone everything hanging off a template service config" layer would stop
 * each path from having to enumerate them.
 */
export async function cloneTemplateServiceFixedConfig(
  trx: Knex | Knex.Transaction,
  tenant: string,
  sourceConfigId: string,
  targetConfigId: string,
  /**
   * The unit rate in the CONTRACT's currency (the resolved `member_rate` slot,
   * null = follow the catalog). The template's own base_rate column is never
   * copied: it is in the template's currency.
   */
  baseRate: number | null
): Promise<void> {
  const db = tenantDb(trx, tenant);
  const fixedConfig = await db.table<{ base_rate: number | string | null; pricing_basis: string | null }>(
    'contract_template_line_service_fixed_config'
  )
    .where('config_id', sourceConfigId)
    .first('base_rate', 'pricing_basis');

  if (!fixedConfig) return;

  // Template fixed-config rows exist only for per-unit services, whose rate is per unit.
  const rate = resolveFixedMemberRatePair({
    base_rate: baseRate,
    base_rate_basis: 'per_unit',
    pricing_basis: fixedConfig.pricing_basis ?? null,
  });

  await db.table('contract_line_service_fixed_config').insert({
    tenant,
    config_id: targetConfigId,
    ...rate,
    pricing_basis: fixedConfig.pricing_basis ?? null,
    rate_provenance: fixedMemberRateProvenance(rate),
    created_at: trx.fn.now(),
    updated_at: trx.fn.now()
  });
}
