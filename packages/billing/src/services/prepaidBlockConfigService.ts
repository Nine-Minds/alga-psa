import { resolvePrepaidBlockBusinessDate } from '../lib/prepaidBlockDates';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import {
  PREPAID_BLOCK_ISSUE_MODES,
  PREPAID_BLOCK_MAX_ROLLOVER_PERIODS,
  type IContractLinePrepaidBlock,
  type PrepaidBlockIssueMode,
  type PrepaidBlockReplenishmentTier,
} from '@alga-psa/types';
import {
  scheduleStartIssuanceAfterCadenceSwitch,
  syncPrepaidBlockIssuancesForContractLine,
} from './prepaidBlockIssuanceSync';
import { syncRecurringServicePeriodsForContractLine } from '../actions/recurringServicePeriodSync';

/**
 * Transaction-level helpers for the Prepaid Block line config
 * (`contract_line_prepaid_blocks`, plan D1/D5/section 7). A Prepaid Block line
 * is an Hourly line plus one config row; there is no new contract_line_type, so
 * UI surfaces get a *derived* display kind from {@link resolveContractLineDisplayKinds}.
 *
 * Lives outside the 'use server' action files so the preset copy, custom-line
 * creation and the config action all share one validation path.
 *
 * Messages start with "Cannot" so action wrappers can turn them into expected
 * (non-throwing) action errors.
 */

export const PREPAID_BLOCK_DISPLAY_KIND = 'PrepaidBlock' as const;
export type ContractLineDisplayKind = 'Fixed' | 'Hourly' | 'Usage' | typeof PREPAID_BLOCK_DISPLAY_KIND;

export const PREPAID_BLOCK_REPLENISHMENT_TIERS: readonly PrepaidBlockReplenishmentTier[] = ['draft', 'auto_issue'];
export const PREPAID_BLOCK_MAX_EXPIRY_MONTHS = 120;

export interface PrepaidBlockConfigInput {
  /** 'consumption' (default) or 'cadence' (one block per service period, billed in advance). */
  issue_mode?: PrepaidBlockIssueMode;
  /** Cadence mode only: further periods a block stays valid after its own (0..12, default 0). */
  rollover_periods?: number;
  /** Block size in minutes. Fractional hours are fine (e.g. 90 = 1.5 h). */
  block_minutes: number;
  /** Minor units of the contract currency. */
  block_price: number;
  /** One of the line's services; defaults to the first covered service. */
  sold_as_service_id?: string | null;
  expiry_months?: number | null;
  trigger_on_exhaustion?: boolean;
  trigger_threshold_percent?: number | null;
  trigger_on_expiry?: boolean;
  trigger_on_renewal?: boolean;
  replenishment_tier?: PrepaidBlockReplenishmentTier;
}

/** Normalised, schema-shaped config (everything defaulted). */
export interface NormalizedPrepaidBlockConfig {
  issue_mode: PrepaidBlockIssueMode;
  rollover_periods: number;
  block_minutes: number;
  block_price: number;
  sold_as_service_id: string | null;
  expiry_months: number | null;
  trigger_on_exhaustion: boolean;
  trigger_threshold_percent: number | null;
  trigger_on_expiry: boolean;
  trigger_on_renewal: boolean;
  replenishment_tier: PrepaidBlockReplenishmentTier;
}

export type PrepaidBlockConfigWarning = {
  code: 'covered_service_on_other_active_line';
  service_id: string;
  service_name: string;
  other_contract_line_id: string;
  other_contract_line_name: string;
};

export interface UpsertPrepaidBlockResult {
  config: IContractLinePrepaidBlock;
  warnings: PrepaidBlockConfigWarning[];
}

/** Pure shape validation shared by line, preset and (later) template writers. */
export function normalizePrepaidBlockConfigInput(input: PrepaidBlockConfigInput): NormalizedPrepaidBlockConfig {
  if (!Number.isSafeInteger(input.block_minutes) || input.block_minutes <= 0) {
    throw new Error('Cannot save prepaid block: the block size must be a whole number of minutes greater than zero.');
  }
  if (!Number.isSafeInteger(input.block_price) || input.block_price < 0) {
    throw new Error('Cannot save prepaid block: the block price must be zero or greater (in minor currency units).');
  }
  const issueMode = input.issue_mode ?? 'consumption';
  if (!PREPAID_BLOCK_ISSUE_MODES.includes(issueMode)) {
    throw new Error('Cannot save prepaid block: issue blocks either every billing period or when the current block runs out.');
  }
  const rolloverPeriods = input.rollover_periods ?? 0;
  if (!Number.isInteger(rolloverPeriods) || rolloverPeriods < 0 || rolloverPeriods > PREPAID_BLOCK_MAX_ROLLOVER_PERIODS) {
    throw new Error(`Cannot save prepaid block: unused hours can carry over for 0 to ${PREPAID_BLOCK_MAX_ROLLOVER_PERIODS} periods.`);
  }
  const tier = input.replenishment_tier ?? 'draft';
  if (!PREPAID_BLOCK_REPLENISHMENT_TIERS.includes(tier)) {
    throw new Error('Cannot save prepaid block: the follow-on block must be a draft or auto-issued invoice.');
  }
  const base = {
    issue_mode: issueMode,
    rollover_periods: rolloverPeriods,
    block_minutes: input.block_minutes,
    block_price: input.block_price,
    sold_as_service_id: input.sold_as_service_id ?? null,
    replenishment_tier: tier,
  };

  if (issueMode === 'cadence') {
    // The consumption triggers do not apply (a block per period is issued by the cadence, and
    // its validity is counted in periods, not months). Only an explicit conflicting value is
    // refused; unset and "off" values mean the same thing here.
    if (input.trigger_on_exhaustion
      || input.trigger_on_expiry
      || input.trigger_on_renewal
      || input.trigger_threshold_percent != null
      || input.expiry_months != null) {
      throw new Error('Cannot save prepaid block: blocks issued every billing period do not use the exhaustion, threshold, expiry or renewal triggers, or an expiry period. Carry unused hours over with the rollover setting instead.');
    }
    return {
      ...base,
      expiry_months: null,
      trigger_on_exhaustion: false,
      trigger_threshold_percent: null,
      trigger_on_expiry: false,
      trigger_on_renewal: false,
    };
  }
  if (rolloverPeriods !== 0) {
    throw new Error('Cannot save prepaid block: rollover applies only to blocks issued every billing period.');
  }

  const expiryMonths = input.expiry_months ?? null;
  if (expiryMonths !== null
    && (!Number.isInteger(expiryMonths) || expiryMonths < 1 || expiryMonths > PREPAID_BLOCK_MAX_EXPIRY_MONTHS)) {
    throw new Error(`Cannot save prepaid block: expiry must be between 1 and ${PREPAID_BLOCK_MAX_EXPIRY_MONTHS} months, or left empty for no expiry.`);
  }
  const triggerOnExpiry = input.trigger_on_expiry ?? (expiryMonths !== null);
  if (expiryMonths === null && triggerOnExpiry) {
    throw new Error('Cannot save prepaid block: "issue next block at expiry" requires an expiry period.');
  }
  const threshold = input.trigger_threshold_percent ?? null;
  if (threshold !== null && (!Number.isInteger(threshold) || threshold < 1 || threshold > 99)) {
    throw new Error('Cannot save prepaid block: the usage threshold must be between 1 and 99 percent.');
  }
  return {
    ...base,
    expiry_months: expiryMonths,
    trigger_on_exhaustion: input.trigger_on_exhaustion ?? true,
    trigger_threshold_percent: threshold,
    trigger_on_expiry: triggerOnExpiry,
    trigger_on_renewal: input.trigger_on_renewal ?? false,
  };
}

interface CoveredService {
  service_id: string;
  service_name: string;
  hourly_rate: number;
}

/**
 * The line's covered services with their effective hourly rate: the hourly
 * config's rate, falling back to the service allocation's custom rate. The
 * billing engine bills a missing rate as 0, which is why a block line refuses
 * a zero rate (overage must never be free).
 */
export async function loadCoveredServicesWithHourlyRates(
  trx: Knex | Knex.Transaction,
  tenant: string,
  contractLineId: string,
): Promise<CoveredService[]> {
  const db = tenantDb(trx, tenant);
  const query = db.table('contract_line_services as cls');
  db.tenantJoin(query, 'service_catalog as sc', 'sc.service_id', 'cls.service_id', { type: 'left' });
  db.tenantJoin(query, 'contract_line_service_configuration as cfg', 'cfg.service_id', 'cls.service_id', {
    type: 'left',
    on: (join) => { join.andOn('cfg.contract_line_id', 'cls.contract_line_id'); },
  });
  const rows = await (query as Knex.QueryBuilder)
    .where('cls.contract_line_id', contractLineId)
    .select('cls.service_id as service_id', 'sc.service_name as service_name', 'cfg.config_id as config_id', 'cfg.custom_rate as custom_rate') as Array<{
      service_id: string; service_name: string | null; config_id: string | null; custom_rate: string | number | null;
    }>;
  const configIds = rows.map((r) => r.config_id).filter((id): id is string => !!id);
  const hourly = configIds.length === 0
    ? []
    : await db.table('contract_line_service_hourly_configs').whereIn('config_id', configIds).select('config_id', 'hourly_rate');
  const hourlyByConfig = new Map<string, number | null>(
    hourly.map((h: { config_id: string; hourly_rate: string | number | null }) => [
      h.config_id,
      h.hourly_rate == null ? null : Number(h.hourly_rate),
    ]),
  );
  const byService = new Map<string, CoveredService>();
  for (const row of rows) {
    const hourlyRate = row.config_id ? hourlyByConfig.get(row.config_id) ?? null : null;
    const rate = hourlyRate ?? (row.custom_rate == null ? 0 : Number(row.custom_rate));
    const existing = byService.get(row.service_id);
    // Several config rows can share a service; the best positive rate wins.
    if (!existing || rate > existing.hourly_rate) {
      byService.set(row.service_id, {
        service_id: row.service_id,
        service_name: row.service_name ?? row.service_id,
        hourly_rate: rate,
      });
    }
  }
  return [...byService.values()].sort((a, b) => a.service_name.localeCompare(b.service_name) || a.service_id.localeCompare(b.service_id));
}

/** Throws when the line is a Prepaid Block line (block lines carry no bucket pools). */
export async function assertContractLineHasNoPrepaidBlock(
  trx: Knex | Knex.Transaction,
  tenant: string,
  contractLineId: string,
): Promise<void> {
  const config = await tenantDb(trx, tenant).table('contract_line_prepaid_blocks')
    .where({ contract_line_id: contractLineId })
    .first('contract_line_id');
  if (config) {
    throw new Error('Cannot add a bucket pool to a Prepaid Block line: remove the prepaid block configuration first.');
  }
}

async function findOtherActiveLineWarnings(
  trx: Knex.Transaction,
  tenant: string,
  contractId: string,
  contractLineId: string,
  covered: CoveredService[],
): Promise<PrepaidBlockConfigWarning[]> {
  const db = tenantDb(trx, tenant);
  const today = await resolvePrepaidBlockBusinessDate(trx, tenant);
  const clientIds: string[] = await db.table('client_contracts')
    .where({ contract_id: contractId, is_active: true })
    .pluck('client_id');
  if (clientIds.length === 0 || covered.length === 0) return [];

  const query = db.table('client_contracts as cc')
    .whereIn('cc.client_id', clientIds)
    .where({ 'cc.is_active': true })
    .where((b) => b.whereNull('cc.start_date').orWhere('cc.start_date', '<=', today))
    .where((b) => b.whereNull('cc.end_date').orWhere('cc.end_date', '>=', today));
  db.tenantJoin(query, 'contracts as ct', 'ct.contract_id', 'cc.contract_id');
  db.tenantJoin(query, 'contract_lines as cl', 'cl.contract_id', 'cc.contract_id');
  db.tenantJoin(query, 'contract_line_services as cls', 'cls.contract_line_id', 'cl.contract_line_id');
  const rows = await (query as Knex.QueryBuilder)
    .whereNot('cl.contract_line_id', contractLineId)
    .whereNotIn('ct.status', ['draft', 'terminated', 'archived'])
    .whereIn('cls.service_id', covered.map((s) => s.service_id))
    .select('cls.service_id as service_id', 'cl.contract_line_id as line_id', 'cl.contract_line_name as line_name') as Array<{
      service_id: string; line_id: string; line_name: string;
    }>;

  const nameByService = new Map(covered.map((s) => [s.service_id, s.service_name]));
  const seen = new Set<string>();
  const warnings: PrepaidBlockConfigWarning[] = [];
  for (const row of rows) {
    const key = `${row.service_id}:${row.line_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    warnings.push({
      code: 'covered_service_on_other_active_line',
      service_id: row.service_id,
      service_name: nameByService.get(row.service_id) ?? row.service_id,
      other_contract_line_id: row.line_id,
      other_contract_line_name: row.line_name,
    });
  }
  return warnings;
}

/**
 * A cadence block is its own recurring stream of the line (plan D3/D9), so a
 * config change that adds or removes that stream re-synchronizes the line's
 * service periods in the same transaction (under the config lock the caller
 * already holds): switching to cadence materializes block periods from the
 * next unbilled one; switching away (or removing the config) retires the
 * unbilled ones. Billed periods and live blocks are never touched. Editing a
 * live cadence config (size, price, rollover) needs no sync: the terms are read
 * when a period is billed, so it applies to the next unbilled period only.
 */
async function applyIssueModeChange(
  trx: Knex.Transaction,
  tenant: string,
  contractLineId: string,
  previousMode: PrepaidBlockIssueMode | null,
  nextMode: PrepaidBlockIssueMode | null,
): Promise<void> {
  const wasCadence = previousMode === 'cadence';
  const isCadence = nextMode === 'cadence';
  if (wasCadence === isCadence) return;
  await syncRecurringServicePeriodsForContractLine(trx, {
    tenant,
    contractLineId,
    sourceRunPrefix: isCadence ? 'prepaid_block_cadence_enabled' : 'prepaid_block_cadence_disabled',
  });
  if (wasCadence && nextMode === 'consumption') {
    await scheduleStartIssuanceAfterCadenceSwitch(trx, tenant, contractLineId);
  }
}

/**
 * Create or replace a line's block config. Validates the line (Hourly, no
 * pools, sold-as service on the line, every covered service rate > 0), writes
 * the row, and syncs the line's block issuances. The config row is locked
 * before anything else (plan Risk 6 lock order).
 */
export async function upsertContractLinePrepaidBlockInTransaction(
  trx: Knex.Transaction,
  tenant: string,
  contractLineId: string,
  input: PrepaidBlockConfigInput,
): Promise<UpsertPrepaidBlockResult> {
  const normalized = normalizePrepaidBlockConfigInput(input);
  const db = tenantDb(trx, tenant);

  // Lock an existing config row first; a first-time insert is serialised by the PK.
  const previous = await db.table('contract_line_prepaid_blocks')
    .where({ contract_line_id: contractLineId })
    .forUpdate()
    .first('contract_line_id', 'issue_mode');

  const line = await db.table('contract_lines')
    .where({ contract_line_id: contractLineId })
    .first('contract_line_id', 'contract_id', 'contract_line_type');
  if (!line) {
    throw new Error('Cannot save prepaid block: the contract line was not found.');
  }
  if (line.contract_line_type !== 'Hourly') {
    throw new Error('Cannot save prepaid block: only Hourly contract lines can be sold as prepaid blocks.');
  }

  const pool = await db.table('contract_line_buckets').where({ contract_line_id: contractLineId }).first('bucket_id');
  if (pool) {
    throw new Error('Cannot save prepaid block: this line has bucket pools. A Prepaid Block line cannot also carry pools.');
  }

  const covered = await loadCoveredServicesWithHourlyRates(trx, tenant, contractLineId);
  if (covered.length === 0) {
    throw new Error('Cannot save prepaid block: add at least one service to the line first.');
  }
  const soldAs = normalized.sold_as_service_id ?? covered[0].service_id;
  if (!covered.some((s) => s.service_id === soldAs)) {
    throw new Error('Cannot save prepaid block: the block must be sold as one of the line\'s services.');
  }
  const unpriced = covered.filter((s) => !(s.hourly_rate > 0));
  if (unpriced.length > 0) {
    throw new Error(
      `Cannot save prepaid block: every covered service needs an hourly rate above zero (overage bills at that rate). Missing: ${unpriced.map((s) => s.service_name).join(', ')}.`,
    );
  }

  const now = new Date().toISOString();
  await db.table('contract_line_prepaid_blocks')
    .insert({
      tenant,
      contract_line_id: contractLineId,
      ...normalized,
      sold_as_service_id: soldAs,
    })
    .onConflict(['tenant', 'contract_line_id'])
    .merge({ ...normalized, sold_as_service_id: soldAs, updated_at: now });

  await syncPrepaidBlockIssuancesForContractLine(trx, tenant, contractLineId);
  await applyIssueModeChange(trx, tenant, contractLineId, previous?.issue_mode ?? null, normalized.issue_mode);

  const config = await db.table('contract_line_prepaid_blocks')
    .where({ contract_line_id: contractLineId })
    .first() as IContractLinePrepaidBlock;
  const warnings = await findOtherActiveLineWarnings(trx, tenant, line.contract_id, contractLineId, covered);
  return { config, warnings };
}

/** Remove a line's block config; scheduled issuances are cancelled by the sync. Block history is untouched. */
export async function removeContractLinePrepaidBlockInTransaction(
  trx: Knex.Transaction,
  tenant: string,
  contractLineId: string,
): Promise<{ removed: boolean }> {
  const db = tenantDb(trx, tenant);
  const existing = await db.table('contract_line_prepaid_blocks')
    .where({ contract_line_id: contractLineId })
    .forUpdate()
    .first('contract_line_id');
  if (!existing) return { removed: false };

  // Removing the config strands blocks (the burn engine only draws for lines
  // that have a config), so refuse while any block still holds hours or awaits
  // finalization. Fully used / expired / voided history is kept untouched.
  const live = await db.table('hour_blocks')
    .where({ contract_line_id: contractLineId })
    .where((b) => b.where({ status: 'pending' }).orWhere((a) => a.where({ status: 'active' }).where('remaining_minutes', '>', 0)))
    .first('block_id');
  if (live) {
    throw new Error('Cannot remove prepaid block configuration: the line has a pending block or a block with hours remaining. Let it be used up or expire (or delete its draft invoice) first.');
  }

  const previousMode = (await db.table('contract_line_prepaid_blocks')
    .where({ contract_line_id: contractLineId })
    .first('issue_mode'))?.issue_mode ?? null;
  await db.table('contract_line_prepaid_blocks').where({ contract_line_id: contractLineId }).delete();
  await syncPrepaidBlockIssuancesForContractLine(trx, tenant, contractLineId);
  await applyIssueModeChange(trx, tenant, contractLineId, previousMode, null);
  return { removed: true };
}

/**
 * Copy a preset's block config onto a freshly created line (validated like a
 * direct upsert, so a preset without hourly rates cannot yield a block line
 * that would bill overage at zero).
 */
export async function copyPresetPrepaidBlockToLine(
  trx: Knex.Transaction,
  tenant: string,
  presetId: string,
  contractLineId: string,
): Promise<UpsertPrepaidBlockResult | null> {
  const db = tenantDb(trx, tenant);
  const preset = await db.table('contract_line_preset_prepaid_blocks').where({ preset_id: presetId }).first();
  if (!preset) return null;
  const covered = await loadCoveredServicesWithHourlyRates(trx, tenant, contractLineId);
  const soldAs = preset.sold_as_service_id && covered.some((s) => s.service_id === preset.sold_as_service_id)
    ? preset.sold_as_service_id
    : null;
  return upsertContractLinePrepaidBlockInTransaction(trx, tenant, contractLineId, {
    block_minutes: Number(preset.block_minutes),
    block_price: Number(preset.block_price),
    sold_as_service_id: soldAs,
    issue_mode: preset.issue_mode ?? 'consumption',
    rollover_periods: Number(preset.rollover_periods ?? 0),
    expiry_months: preset.expiry_months == null ? null : Number(preset.expiry_months),
    trigger_on_exhaustion: Boolean(preset.trigger_on_exhaustion),
    trigger_threshold_percent: preset.trigger_threshold_percent == null ? null : Number(preset.trigger_threshold_percent),
    trigger_on_expiry: Boolean(preset.trigger_on_expiry),
    trigger_on_renewal: Boolean(preset.trigger_on_renewal),
    replenishment_tier: preset.replenishment_tier,
  });
}

/** Store a preset's block config (preset create-from-custom). Service/rate validation happens when the preset is copied to a line. */
export async function upsertPresetPrepaidBlockInTransaction(
  trx: Knex.Transaction,
  tenant: string,
  presetId: string,
  input: PrepaidBlockConfigInput,
): Promise<void> {
  const normalized = normalizePrepaidBlockConfigInput(input);
  await tenantDb(trx, tenant).table('contract_line_preset_prepaid_blocks')
    .insert({ tenant, preset_id: presetId, ...normalized })
    .onConflict(['tenant', 'preset_id'])
    .merge({ ...normalized, updated_at: new Date().toISOString() });
}

/**
 * Derived display kind for UI labels: 'PrepaidBlock' for Hourly lines carrying
 * a block config, else the stored contract_line_type. Never persisted.
 */
export async function resolveContractLineDisplayKinds(
  trx: Knex | Knex.Transaction,
  tenant: string,
  lines: Array<{ contract_line_id: string; contract_line_type: string }>,
): Promise<Map<string, string>> {
  const result = new Map<string, string>(lines.map((l) => [l.contract_line_id, l.contract_line_type]));
  const hourlyIds = lines.filter((l) => l.contract_line_type === 'Hourly').map((l) => l.contract_line_id);
  if (hourlyIds.length === 0) return result;
  const blockLineIds: string[] = await tenantDb(trx, tenant).table('contract_line_prepaid_blocks')
    .whereIn('contract_line_id', hourlyIds)
    .pluck('contract_line_id');
  for (const id of blockLineIds) result.set(id, PREPAID_BLOCK_DISPLAY_KIND);
  return result;
}

/** Template-line counterpart of {@link resolveContractLineDisplayKinds} (keys are template_line_id). */
export async function resolveTemplateLineDisplayKinds(
  trx: Knex | Knex.Transaction,
  tenant: string,
  lines: Array<{ contract_line_id: string; contract_line_type: string }>,
): Promise<Map<string, string>> {
  const result = new Map<string, string>(lines.map((l) => [l.contract_line_id, l.contract_line_type]));
  const hourlyIds = lines.filter((l) => l.contract_line_type === 'Hourly').map((l) => l.contract_line_id);
  if (hourlyIds.length === 0) return result;
  const blockLineIds: string[] = await tenantDb(trx, tenant).table('contract_template_line_prepaid_blocks')
    .whereIn('template_line_id', hourlyIds)
    .pluck('template_line_id');
  for (const id of blockLineIds) result.set(id, PREPAID_BLOCK_DISPLAY_KIND);
  return result;
}

/**
 * Create or replace a TEMPLATE line's block config (contract_template_line_prepaid_blocks).
 * Templates are currency-neutral and may carry no hourly rate yet, so only the structural
 * rules are enforced here (Hourly template line, no template pools, sold-as service on the line);
 * the rate rule is enforced when the config is cloned onto a contract line. Returns the stored row.
 */
export async function upsertTemplateLinePrepaidBlockInTransaction(
  trx: Knex.Transaction,
  tenant: string,
  templateLineId: string,
  input: PrepaidBlockConfigInput,
): Promise<NormalizedPrepaidBlockConfig & { template_line_id: string }> {
  const normalized = normalizePrepaidBlockConfigInput(input);
  const db = tenantDb(trx, tenant);

  const line = await db.table('contract_template_lines')
    .where({ template_line_id: templateLineId })
    .first('template_line_id', 'line_type');
  if (!line) {
    throw new Error('Cannot save prepaid block: the template line was not found.');
  }
  if (line.line_type !== 'Hourly') {
    throw new Error('Cannot save prepaid block: only Hourly template lines can be sold as prepaid blocks.');
  }

  const pool = await db.table('contract_template_line_buckets').where({ template_line_id: templateLineId }).first('bucket_id');
  if (pool) {
    throw new Error('Cannot save prepaid block: this template line has bucket pools. A Prepaid Block line cannot also carry pools.');
  }

  const serviceIds: string[] = await db.table('contract_template_line_services')
    .where({ template_line_id: templateLineId })
    .orderBy('display_order', 'asc')
    .pluck('service_id');
  if (serviceIds.length === 0) {
    throw new Error('Cannot save prepaid block: add at least one service to the template line first.');
  }
  const soldAs = normalized.sold_as_service_id ?? serviceIds[0];
  if (!serviceIds.includes(soldAs)) {
    throw new Error('Cannot save prepaid block: the block must be sold as one of the line\'s services.');
  }

  await db.table('contract_template_line_prepaid_blocks')
    .insert({ tenant, template_line_id: templateLineId, ...normalized, sold_as_service_id: soldAs })
    .onConflict(['tenant', 'template_line_id'])
    .merge({ ...normalized, sold_as_service_id: soldAs, updated_at: new Date().toISOString() });

  return { template_line_id: templateLineId, ...normalized, sold_as_service_id: soldAs };
}

export async function removeTemplateLinePrepaidBlockInTransaction(
  trx: Knex.Transaction,
  tenant: string,
  templateLineId: string,
): Promise<{ removed: boolean }> {
  const removed = await tenantDb(trx, tenant).table('contract_template_line_prepaid_blocks')
    .where({ template_line_id: templateLineId })
    .delete();
  return { removed: Number(removed) > 0 };
}
