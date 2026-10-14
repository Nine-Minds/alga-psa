/**
 * Template amount slots: the one layer under every template -> contract clone.
 *
 * A contract template stores money in many columns (line rate, bundle shares,
 * per-seat/hourly/usage rates, overtime, bucket overage ...). Those columns hold
 * amounts in the template's BASE currency (`contract_templates.currency_code`).
 * Other currencies live in per-currency price sets
 * (`contract_template_price_sets` / `contract_template_prices`), one row per slot.
 *
 * This module turns that into one shape - a flat list of "amount slots" with a
 * stable `slot_key` - and resolves, for a target currency, which amount (if any)
 * is valid in it. HARD RULE: an amount is never copied across currencies and
 * there is no FX conversion; a slot with no amount in the target currency is
 * simply unset.
 *
 * Slot existence: a slot exists only when the base template has a positive
 * amount for that field, or a $0 line rate that `templateLineRateCents` treats as
 * an intentional snapshot. A field the base leaves empty ("follow the catalog")
 * has no slot in any currency.
 */
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TemplateAmountSlotKind =
  | 'line_base_rate'
  | 'member_rate'
  | 'line_overtime_rate'
  | 'member_overtime_rate'
  | 'bucket_overage_rate'
  | 'legacy_bucket_overage_rate';

export interface TemplateAmountSlot {
  slot_key: string;
  slot_kind: TemplateAmountSlotKind;
  template_line_id: string;
  service_id: string | null;
  /** Template pool id (contract_template_line_buckets.bucket_id). */
  bucket_id: string | null;
  /** Cents, in `template.currency_code`. */
  base_amount: number;
  /** False only for bundle shares (derived from the line rate). */
  required: boolean;
  /** Human label for error messages and the Pricing grid. */
  label: string;
  template_line_name: string;
  line_type: string;
  service_name: string | null;
  bucket_name: string | null;
}

export interface ResolvedTemplateAmounts {
  template_id: string;
  /** Base currency of the template. */
  template_currency: string;
  target_currency: string;
  /** 'none' = mismatch fallback (no amount is valid in the target currency). */
  source: 'base' | 'price_set' | 'none';
  slots: TemplateAmountSlot[];
  /** Only amounts valid in `target_currency`, keyed by slot_key (cents). */
  amountBySlot: Map<string, number>;
  /** Every non-base currency that has a price set for this template. */
  price_set_currencies: string[];
}

export interface TemplateCurrencySummary {
  base: string;
  /** Currencies (other than base) that have a price set. */
  sets: string[];
  /** Subset of `sets` that lacks at least one REQUIRED slot of the current structure. */
  incomplete_sets: string[];
}

/** Structural subset of the wizard's per-line edits that carry amounts. */
export interface TemplateAmountEditInput {
  template_line_id: string;
  fixed_base_rate?: number | null;
  overtime_rate?: number | null;
  services?: Array<{
    service_id: string;
    rate?: number | null;
    overtime_rate?: number | null;
    bucket_overage_rate?: number | null;
  }>;
  /** Keyed by TEMPLATE pool id. */
  bucket_overage_rates?: Array<{ bucket_id: string; rate: number | null }>;
}

// ---------------------------------------------------------------------------
// Slot keys
// ---------------------------------------------------------------------------

export interface TemplateAmountSlotIds {
  template_line_id: string;
  service_id?: string | null;
  bucket_id?: string | null;
}

/** The ONE place slot keys are built. */
export function templateAmountSlotKey(kind: TemplateAmountSlotKind, ids: TemplateAmountSlotIds): string {
  const line = `line:${ids.template_line_id}`;
  switch (kind) {
    case 'line_base_rate':
      return `${line}:base_rate`;
    case 'line_overtime_rate':
      return `${line}:overtime_rate`;
    case 'member_rate':
      return `${line}:svc:${requireId(ids.service_id, kind)}:rate`;
    case 'member_overtime_rate':
      return `${line}:svc:${requireId(ids.service_id, kind)}:overtime_rate`;
    case 'legacy_bucket_overage_rate':
      return `${line}:svc:${requireId(ids.service_id, kind)}:bucket_overage_rate`;
    case 'bucket_overage_rate':
      return `${line}:bucket:${requireId(ids.bucket_id, kind)}:overage_rate`;
    default:
      throw new Error(`Unknown template amount slot kind: ${String(kind)}`);
  }
}

function requireId(id: string | null | undefined, kind: string): string {
  if (!id) throw new Error(`Slot kind ${kind} requires an id`);
  return id;
}

// ---------------------------------------------------------------------------
// Base precedence (moved from contractLineRepository; behaviour unchanged)
// ---------------------------------------------------------------------------

export const positiveCentsOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const numeric = typeof value === 'string' ? Number.parseFloat(value) : Number(value);
  if (!Number.isFinite(numeric)) return null;
  const rounded = Math.round(numeric);
  return rounded > 0 ? rounded : null;
};

export const nonNegativeCentsOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const numeric = typeof value === 'string' ? Number.parseFloat(value) : Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Math.round(numeric));
};

/**
 * The line rate a template line carries over (cents), or null when the line
 * follows the catalog. A rate stored on the template line itself is an
 * intentional snapshot, $0 included. The line fixed config is written as
 * `fixed_base_rate ?? 0` by template authoring, so there 0 means "no rate".
 */
export function templateLineRateCents(templateLine: any, templateFixedConfig: any): number | null {
  return nonNegativeCentsOrNull(templateLine?.custom_rate) ?? positiveCentsOrNull(templateFixedConfig?.base_rate);
}

/**
 * The rate a Fixed template member carries over (cents). A per-seat member's
 * unit rate lives only in its service fixed config (null follows the catalog);
 * a bundle member's allocated share lives on the configuration/service row.
 */
export function templateFixedMemberRateCents(configuration: any, service: any, serviceFixedConfig: any): number | null {
  if (serviceFixedConfig?.pricing_basis === 'unit') {
    return positiveCentsOrNull(serviceFixedConfig.base_rate);
  }
  return positiveCentsOrNull(configuration?.custom_rate) ?? positiveCentsOrNull(service.custom_rate);
}

/**
 * The member rate a template stores for a service, by line type: Hourly =
 * typed hourly config -> configuration.custom_rate -> service.custom_rate;
 * Usage = typed usage config -> same two; Fixed = `templateFixedMemberRateCents`.
 */
export function templateMemberRateCents(
  lineType: string,
  parts: { configuration: any; service: any; hourly?: any; usage?: any; serviceFixed?: any },
): number | null {
  const { configuration, service, hourly, usage, serviceFixed } = parts;
  if (lineType === 'Hourly') {
    return (
      positiveCentsOrNull(hourly?.hourly_rate) ??
      positiveCentsOrNull(configuration?.custom_rate) ??
      positiveCentsOrNull(service.custom_rate)
    );
  }
  if (lineType === 'Usage') {
    return (
      positiveCentsOrNull(usage?.base_rate) ??
      positiveCentsOrNull(configuration?.custom_rate) ??
      positiveCentsOrNull(service.custom_rate)
    );
  }
  return templateFixedMemberRateCents(configuration, service, serviceFixed);
}

// ---------------------------------------------------------------------------
// Enumeration
// ---------------------------------------------------------------------------

type KnexLike = Knex | Knex.Transaction;

interface TemplateStructure {
  template_id: string;
  currency: string;
  slots: TemplateAmountSlot[];
}

const byOrder = (a: any, b: any): number => {
  const orderDelta = Number(a.display_order ?? 0) - Number(b.display_order ?? 0);
  if (orderDelta !== 0) return orderDelta;
  const left = a.created_at ? new Date(a.created_at).getTime() : 0;
  const right = b.created_at ? new Date(b.created_at).getTime() : 0;
  return left - right;
};

function groupBy<T>(rows: T[], keyOf: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const bucket = map.get(key);
    if (bucket) bucket.push(row);
    else map.set(key, [row]);
  }
  return map;
}

/** Loads the structure of every template in a constant number of queries. */
async function loadTemplateStructures(
  knex: KnexLike,
  tenant: string,
  templateIds: string[],
): Promise<Map<string, TemplateStructure>> {
  const result = new Map<string, TemplateStructure>();
  const ids = Array.from(new Set(templateIds.filter(Boolean)));
  if (ids.length === 0) return result;
  const db = tenantDb(knex, tenant);

  const templates = (await db.table('contract_templates').whereIn('template_id', ids).select('template_id', 'currency_code')) as any[];
  const lines = (await db.table('contract_template_lines').whereIn('template_id', ids)) as any[];
  const lineIds = lines.map((line) => line.template_line_id as string);

  const rowsForLines = async (table: string): Promise<any[]> =>
    lineIds.length ? ((await db.table(table).whereIn('template_line_id', lineIds)) as any[]) : [];

  const fixedConfigs = await rowsForLines('contract_template_line_fixed_config');
  const services = await rowsForLines('contract_template_line_services');
  const configurations = await rowsForLines('contract_template_line_service_configuration');
  const pools = await rowsForLines('contract_template_line_buckets');

  const configIds = configurations.map((c) => c.config_id as string);
  const rowsForConfigs = async (table: string): Promise<any[]> =>
    configIds.length ? ((await db.table(table).whereIn('config_id', configIds)) as any[]) : [];
  const serviceFixed = await rowsForConfigs('contract_template_line_service_fixed_config');
  const hourly = await rowsForConfigs('contract_template_line_service_hourly_config');
  const usage = await rowsForConfigs('contract_template_line_service_usage_config');
  const legacyBuckets = await rowsForConfigs('contract_template_line_service_bucket_config');

  const serviceIds = Array.from(new Set(services.map((s) => s.service_id as string)));
  const catalog = serviceIds.length
    ? ((await db.table('service_catalog').whereIn('service_id', serviceIds).select('service_id', 'service_name')) as any[])
    : [];
  const serviceNameById = new Map<string, string>(catalog.map((row) => [row.service_id, row.service_name]));

  const fixedByLine = new Map<string, any>(fixedConfigs.map((row) => [row.template_line_id, row]));
  const servicesByLine = groupBy(services, (row) => row.template_line_id);
  const configsByLine = groupBy(configurations, (row) => row.template_line_id);
  const poolsByLine = groupBy(pools, (row) => row.template_line_id);
  const serviceFixedByConfig = new Map<string, any>(serviceFixed.map((row) => [row.config_id, row]));
  const hourlyByConfig = new Map<string, any>(hourly.map((row) => [row.config_id, row]));
  const usageByConfig = new Map<string, any>(usage.map((row) => [row.config_id, row]));
  const legacyByConfig = new Map<string, any>(legacyBuckets.map((row) => [row.config_id, row]));
  const linesByTemplate = groupBy(lines, (row) => row.template_id);

  for (const template of templates) {
    const slots: TemplateAmountSlot[] = [];
    const templateLines = (linesByTemplate.get(template.template_id) ?? []).slice().sort(byOrder);

    for (const line of templateLines) {
      const lineId: string = line.template_line_id;
      const lineType: string = line.line_type ?? 'Fixed';
      const lineName: string = line.template_line_name ?? lineId;
      const linePools = poolsByLine.get(lineId) ?? [];
      const lineConfigs = configsByLine.get(lineId) ?? [];

      const push = (
        kind: TemplateAmountSlotKind,
        baseAmount: number,
        required: boolean,
        field: string,
        extra: { service_id?: string; service_name?: string; bucket_id?: string; bucket_name?: string | null } = {},
      ) => {
        const labelTarget = extra.service_name ?? (extra.bucket_id ? extra.bucket_name || 'Bucket pool' : null);
        slots.push({
          slot_key: templateAmountSlotKey(kind, {
            template_line_id: lineId,
            service_id: extra.service_id ?? null,
            bucket_id: extra.bucket_id ?? null,
          }),
          slot_kind: kind,
          template_line_id: lineId,
          service_id: extra.service_id ?? null,
          bucket_id: extra.bucket_id ?? null,
          base_amount: baseAmount,
          required,
          label: labelTarget ? `${lineName} · ${labelTarget} — ${field}` : `${lineName} — ${field}`,
          template_line_name: lineName,
          line_type: lineType,
          service_name: extra.service_name ?? null,
          bucket_name: extra.bucket_id ? extra.bucket_name ?? null : null,
        });
      };

      // A (also $0 intentional snapshot)
      const lineRate = templateLineRateCents(line, fixedByLine.get(lineId));
      if (lineRate !== null) push('line_base_rate', lineRate, true, 'base rate');

      // F
      const lineOvertime = positiveCentsOrNull(line.overtime_rate);
      if (lineOvertime !== null) push('line_overtime_rate', lineOvertime, true, 'overtime rate');

      // B/C/D/E, G, I per service
      const lineServices = (servicesByLine.get(lineId) ?? []).slice().sort(byOrder);
      for (const service of lineServices) {
        const serviceName: string = serviceNameById.get(service.service_id) ?? service.service_id;
        const serviceConfigs = lineConfigs.filter((c) => c.service_id === service.service_id);
        const configuration = serviceConfigs[0];
        const primarySvcFixed = configuration ? serviceFixedByConfig.get(configuration.config_id) : undefined;
        const isUnit = primarySvcFixed?.pricing_basis === 'unit';

        const memberRate = templateMemberRateCents(lineType, {
          configuration,
          service,
          hourly: configuration ? hourlyByConfig.get(configuration.config_id) : undefined,
          usage: configuration ? usageByConfig.get(configuration.config_id) : undefined,
          serviceFixed: primarySvcFixed,
        });
        if (memberRate !== null) {
          const bundleShare = lineType !== 'Hourly' && lineType !== 'Usage' && !isUnit;
          const field =
            lineType === 'Hourly' ? 'hourly rate' : lineType === 'Usage' ? 'unit rate' : isUnit ? 'unit rate' : 'bundle share';
          push('member_rate', memberRate, !bundleShare, field, {
            service_id: service.service_id,
            service_name: serviceName,
          });
        }

        const memberOvertime = positiveCentsOrNull(
          configuration ? hourlyByConfig.get(configuration.config_id)?.overtime_rate : undefined,
        );
        if (memberOvertime !== null) {
          push('member_overtime_rate', memberOvertime, true, 'overtime rate', {
            service_id: service.service_id,
            service_name: serviceName,
          });
        }

        if (linePools.length === 0) {
          for (const cfg of serviceConfigs) {
            const legacyOverage = positiveCentsOrNull(legacyByConfig.get(cfg.config_id)?.overage_rate);
            if (legacyOverage !== null) {
              push('legacy_bucket_overage_rate', legacyOverage, true, 'bucket overage rate', {
                service_id: service.service_id,
                service_name: serviceName,
              });
              break;
            }
          }
        }
      }

      // H
      for (const pool of linePools.slice().sort(byOrder)) {
        const overage = positiveCentsOrNull(pool.overage_rate);
        if (overage !== null) {
          push('bucket_overage_rate', overage, true, 'overage rate', {
            bucket_id: pool.bucket_id,
            bucket_name: pool.bucket_name ?? null,
          });
        }
      }
    }

    result.set(template.template_id, {
      template_id: template.template_id,
      currency: String(template.currency_code ?? '').toUpperCase(),
      slots,
    });
  }

  return result;
}

async function loadStructure(knex: KnexLike, tenant: string, templateId: string): Promise<TemplateStructure> {
  const structure = (await loadTemplateStructures(knex, tenant, [templateId])).get(templateId);
  if (!structure) throw new Error(`Contract template ${templateId} not found`);
  return structure;
}

/** Every amount slot of a template's current structure, with base amounts. */
export async function enumerateTemplateAmountSlots(
  knex: KnexLike,
  tenant: string,
  templateId: string,
): Promise<TemplateAmountSlot[]> {
  return (await loadStructure(knex, tenant, templateId)).slots;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the amounts of a template for `targetCurrency` (null = the template's
 * own base currency).
 *
 *  - target === base          -> source 'base', every base amount.
 *  - a price set exists       -> source 'price_set', the set's rows that match a
 *                                slot of the CURRENT structure. Slots the set
 *                                lacks are left unset, never filled from base.
 *  - otherwise                -> source 'none', empty amountBySlot.
 */
export async function resolveTemplateAmounts(
  knex: KnexLike,
  tenant: string,
  templateId: string,
  targetCurrency: string | null,
): Promise<ResolvedTemplateAmounts> {
  const structure = await loadStructure(knex, tenant, templateId);
  const db = tenantDb(knex, tenant);
  const target = (targetCurrency ?? structure.currency).trim().toUpperCase();

  const setRows = (await db
    .table('contract_template_price_sets')
    .where({ template_id: templateId })
    .select('currency_code')) as Array<{ currency_code: string }>;
  const priceSetCurrencies = setRows.map((row) => row.currency_code.toUpperCase()).sort();

  const amountBySlot = new Map<string, number>();
  let source: ResolvedTemplateAmounts['source'];

  if (target === structure.currency) {
    source = 'base';
    for (const slot of structure.slots) amountBySlot.set(slot.slot_key, slot.base_amount);
  } else if (priceSetCurrencies.includes(target)) {
    source = 'price_set';
    const known = new Set(structure.slots.map((slot) => slot.slot_key));
    const priceRows = (await db
      .table('contract_template_prices')
      .where({ template_id: templateId, currency_code: target })
      .select('slot_key', 'rate')) as Array<{ slot_key: string; rate: number }>;
    for (const row of priceRows) {
      if (known.has(row.slot_key)) amountBySlot.set(row.slot_key, Number(row.rate));
    }
  } else {
    source = 'none';
  }

  return {
    template_id: templateId,
    template_currency: structure.currency,
    target_currency: target,
    source,
    slots: structure.slots,
    amountBySlot,
    price_set_currencies: priceSetCurrencies,
  };
}

/**
 * Base currency and price-set currencies for many templates in a small constant
 * number of queries (picker). A set is "incomplete" when it lacks a REQUIRED
 * slot of the current structure.
 */
export async function listTemplateCurrencies(
  knex: KnexLike,
  tenant: string,
  templateIds: string[],
): Promise<Map<string, TemplateCurrencySummary>> {
  const result = new Map<string, TemplateCurrencySummary>();
  const ids = Array.from(new Set(templateIds.filter(Boolean)));
  if (ids.length === 0) return result;
  const db = tenantDb(knex, tenant);

  const structures = await loadTemplateStructures(knex, tenant, ids);
  const setRows = (await db
    .table('contract_template_price_sets')
    .whereIn('template_id', ids)
    .select('template_id', 'currency_code')) as Array<{ template_id: string; currency_code: string }>;
  const priceRows = (await db
    .table('contract_template_prices')
    .whereIn('template_id', ids)
    .select('template_id', 'currency_code', 'slot_key')) as Array<{
    template_id: string;
    currency_code: string;
    slot_key: string;
  }>;

  const keysBySet = new Map<string, Set<string>>();
  for (const row of priceRows) {
    const setId = `${row.template_id}|${row.currency_code.toUpperCase()}`;
    const keys = keysBySet.get(setId);
    if (keys) keys.add(row.slot_key);
    else keysBySet.set(setId, new Set([row.slot_key]));
  }

  for (const [templateId, structure] of structures) {
    const requiredKeys = structure.slots.filter((slot) => slot.required).map((slot) => slot.slot_key);
    const sets = setRows
      .filter((row) => row.template_id === templateId)
      .map((row) => row.currency_code.toUpperCase())
      .sort();
    const incomplete = sets.filter((currency) => {
      const present = keysBySet.get(`${templateId}|${currency}`);
      return requiredKeys.some((key) => !present?.has(key));
    });
    result.set(templateId, { base: structure.currency, sets, incomplete_sets: incomplete });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Upsert a price set: header + one row per passed slot. Rows for slots that are
 * not passed are left alone. Rejects the base currency, slot keys that are not in
 * the template's current structure, and negative or non-integer rates.
 */
export async function writeTemplatePriceSet(
  trx: KnexLike,
  tenant: string,
  templateId: string,
  currency: string,
  amounts: Record<string, number>,
  userId: string | null,
): Promise<void> {
  const code = typeof currency === 'string' ? currency.trim().toUpperCase() : '';
  if (!/^[A-Z]{3}$/.test(code)) {
    throw new Error(`Invalid currency code "${currency}" for a template price set`);
  }
  const structure = await loadStructure(trx, tenant, templateId);
  if (code === structure.currency) {
    throw new Error(
      `${code} is the template's base currency; its amounts live in the template itself, not in a price set`,
    );
  }

  const slotByKey = new Map(structure.slots.map((slot) => [slot.slot_key, slot]));
  const entries = Object.entries(amounts);
  for (const [key, rate] of entries) {
    if (!slotByKey.has(key)) {
      throw new Error(`Slot "${key}" is not part of template ${templateId}'s current structure`);
    }
    if (typeof rate !== 'number' || !Number.isInteger(rate) || rate < 0) {
      throw new Error(`Rate for slot "${key}" must be a non-negative integer (minor units), got ${String(rate)}`);
    }
  }

  const db = tenantDb(trx, tenant);
  const now = trx.fn.now();
  await db
    .table('contract_template_price_sets')
    .insert({
      tenant,
      template_id: templateId,
      currency_code: code,
      created_at: now,
      updated_at: now,
      created_by: userId,
      updated_by: userId,
    })
    .onConflict(['tenant', 'template_id', 'currency_code'])
    .merge({ updated_at: now, updated_by: userId });

  for (const [key, rate] of entries) {
    const slot = slotByKey.get(key)!;
    await db
      .table('contract_template_prices')
      .insert({
        tenant,
        template_id: templateId,
        currency_code: code,
        template_line_id: slot.template_line_id,
        slot_kind: slot.slot_kind,
        service_id: slot.service_id,
        bucket_id: slot.bucket_id,
        slot_key: key,
        rate,
        created_at: now,
        updated_at: now,
      })
      .onConflict(['tenant', 'template_id', 'currency_code', 'slot_key'])
      .merge({ rate, updated_at: now });
  }
}

/** Delete a price set (header and rows). Returns true when a set existed. */
export async function deleteTemplatePriceSet(
  trx: KnexLike,
  tenant: string,
  templateId: string,
  currency: string,
): Promise<boolean> {
  const code = currency.trim().toUpperCase();
  const db = tenantDb(trx, tenant);
  await db.table('contract_template_prices').where({ template_id: templateId, currency_code: code }).del();
  const deleted = await db
    .table('contract_template_price_sets')
    .where({ template_id: templateId, currency_code: code })
    .del();
  return Number(deleted) > 0;
}

// ---------------------------------------------------------------------------
// Edits -> slot amounts
// ---------------------------------------------------------------------------

/**
 * Map wizard edits to `{ slotKey: cents }` for the slots of the current
 * structure. Only concrete amounts (finite, >= 0) are mapped: `undefined` and
 * `null` edits carry no amount, and edits for fields that have no slot are
 * dropped (they cannot be stored in a price set).
 */
export function slotAmountsFromEdits(
  slots: TemplateAmountSlot[],
  edits: TemplateAmountEditInput[],
): Record<string, number> {
  const known = new Set(slots.map((slot) => slot.slot_key));
  const out: Record<string, number> = {};
  const put = (key: string, value: number | null | undefined) => {
    if (value === null || value === undefined) return;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) return;
    if (known.has(key)) out[key] = Math.round(numeric);
  };

  for (const edit of edits ?? []) {
    if (!edit?.template_line_id) continue;
    const lineId = edit.template_line_id;
    put(templateAmountSlotKey('line_base_rate', { template_line_id: lineId }), edit.fixed_base_rate);
    put(templateAmountSlotKey('line_overtime_rate', { template_line_id: lineId }), edit.overtime_rate);
    for (const service of edit.services ?? []) {
      if (!service?.service_id) continue;
      const ids = { template_line_id: lineId, service_id: service.service_id };
      put(templateAmountSlotKey('member_rate', ids), service.rate);
      put(templateAmountSlotKey('member_overtime_rate', ids), service.overtime_rate);
      put(templateAmountSlotKey('legacy_bucket_overage_rate', ids), service.bucket_overage_rate);
    }
    for (const pool of edit.bucket_overage_rates ?? []) {
      if (!pool?.bucket_id) continue;
      put(templateAmountSlotKey('bucket_overage_rate', { template_line_id: lineId, bucket_id: pool.bucket_id }), pool.rate);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Legacy clone paths
// ---------------------------------------------------------------------------

/**
 * Resolve a template's amounts for the currency of an existing contract
 * (`contracts.currency_code`; falls back to the template's own currency when the
 * contract carries none). Used by the legacy clone paths (REST ContractLineService,
 * packages/clients) so none of them re-derives which currency an amount is in.
 */
export async function resolveTemplateAmountsForContract(
  knex: KnexLike,
  tenant: string,
  templateId: string,
  contractId: string,
): Promise<ResolvedTemplateAmounts> {
  const contract = (await tenantDb(knex, tenant)
    .table('contracts')
    .where({ contract_id: contractId })
    .first('currency_code')) as { currency_code?: string | null } | undefined;
  return resolveTemplateAmounts(knex, tenant, templateId, contract?.currency_code ?? null);
}

/**
 * Read-side accessors the legacy (column-copying) clones use instead of reading
 * template amount columns. A missing amount is `null`: the legacy paths never
 * reject an unset amount and never substitute another currency's value.
 *
 * LEVERAGE: pattern template-clone-substrate — the legacy clones now share this
 * amount layer but still duplicate structure copying (services, configs, pools).
 */
export function legacyCloneAmountReader(amounts: ResolvedTemplateAmounts, templateLineId: string) {
  const get = (kind: TemplateAmountSlotKind, ids: Omit<TemplateAmountSlotIds, 'template_line_id'> = {}) =>
    amounts.amountBySlot.get(templateAmountSlotKey(kind, { template_line_id: templateLineId, ...ids })) ?? null;
  return {
    lineRate: () => get('line_base_rate'),
    lineOvertimeRate: () => get('line_overtime_rate'),
    memberRate: (serviceId: string) => get('member_rate', { service_id: serviceId }),
    memberOvertimeRate: (serviceId: string) => get('member_overtime_rate', { service_id: serviceId }),
    legacyBucketOverageRate: (serviceId: string) => get('legacy_bucket_overage_rate', { service_id: serviceId }),
    /** Template pool id -> overage cents, for `cloneTemplateLinePools`. */
    poolOverageRates: (): Map<string, number | null> => {
      const map = new Map<string, number | null>();
      for (const slot of amounts.slots) {
        if (slot.template_line_id === templateLineId && slot.slot_kind === 'bucket_overage_rate' && slot.bucket_id) {
          map.set(slot.bucket_id, amounts.amountBySlot.get(slot.slot_key) ?? null);
        }
      }
      return map;
    },
  };
}

// ---------------------------------------------------------------------------
// Live line -> template snapshots
// ---------------------------------------------------------------------------

/**
 * `ensureTemplateLineSnapshot` copies a live contract line into a template's
 * base columns. That line is priced in its contract's currency, so it may only
 * be copied into a template whose base currency is the same; writing it anywhere
 * else would store amounts in a currency they do not belong to. A line with no
 * contract (a template-authoring line) carries no currency and is always allowed.
 * Throws a plain Error naming both currencies.
 */
export async function assertLiveLineMatchesTemplateCurrency(
  knex: KnexLike,
  tenant: string,
  templateId: string,
  contractLineId: string,
): Promise<void> {
  const db = tenantDb(knex, tenant);
  const line = (await db.table('contract_lines').where({ contract_line_id: contractLineId }).first('contract_id')) as
    | { contract_id?: string | null }
    | undefined;
  if (!line?.contract_id) return;
  const contract = (await db.table('contracts').where({ contract_id: line.contract_id }).first('currency_code')) as
    | { currency_code?: string | null }
    | undefined;
  const template = (await db.table('contract_templates').where({ template_id: templateId }).first('currency_code')) as
    | { currency_code?: string | null }
    | undefined;
  if (!contract?.currency_code || !template?.currency_code) return;
  if (contract.currency_code !== template.currency_code) {
    throw new Error(
      `This line is priced in ${contract.currency_code}; the template's base currency is ${template.currency_code}.`,
    );
  }
}

/**
 * Delete every price-set row of one service on one template line. Price rows
 * carry no FK on service_id, so any action that removes a service from a template
 * line calls this in the same transaction.
 */
export async function deleteTemplateServicePrices(
  trx: KnexLike,
  tenant: string,
  templateLineId: string,
  serviceId: string,
): Promise<void> {
  await tenantDb(trx, tenant)
    .table('contract_template_prices')
    .where({ template_line_id: templateLineId, service_id: serviceId })
    .del();
}
