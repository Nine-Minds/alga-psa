import { Knex } from 'knex';
import { toPlainDate } from '@alga-psa/core';
import { lockTenantBilling } from './billingMutationLock';
import { tenantDb } from '@alga-psa/db';
import type { IContractLineUnitPricingRevision } from '@alga-psa/types';
import type {
  RecurringPricePolicy,
  RecurringUnitKind,
  RecurringUnitRevisionRow,
} from '@alga-psa/shared/billingClients/recurringUnitPricing';
import {
  normalizeRecurringBoundary,
  resolveRecurringUnitBaseline,
  selectEffectiveRecurringUnitPricing,
  toRecurringUnitRevisionCandidate,
  type EffectiveRecurringUnitPricing,
} from '@alga-psa/shared/billingClients/recurringUnitPricing';

/**
 * Transactional core of prospective recurring-seat (unit pricing) revisions.
 *
 * A quantity/unit-rate change on an explicitly unit-priced Fixed service is
 * stored as a revision effective at a service-period boundary
 * (contract_line_unit_pricing_revisions). Periods whose covered start is
 * at/after the boundary bill the revision; earlier periods keep their values
 * and are never rewritten. Shared by the explicit scheduling action and the
 * normal service-edit path, so every operator-reachable seat edit is
 * prospective — none writes the live configuration quantity directly once the
 * line has materialized service periods.
 */

function tenantScopedTable(
  conn: Knex | Knex.Transaction,
  tenant: string,
  table: string,
): Knex.QueryBuilder {
  return tenantDb(conn, tenant).table(table);
}

function toBoundaryDay(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  const text = String(value ?? '');
  return text.length >= 10 ? text.slice(0, 10) : text;
}

/**
 * The earliest not-yet-billed service-period boundary for a contract line —
 * where a "change the seats now" edit takes effect: billed/locked periods stay
 * immutable, the first unbilled period (in-flight or future) picks up the new
 * values. Returns null when the line has no unbilled materialized periods, in
 * which case there is nothing prospective to protect.
 */
export async function resolveNextUnbilledSeatBoundary(params: {
  trx: Knex.Transaction;
  tenant: string;
  contractLineId: string;
}): Promise<string | null> {
  const { trx, tenant, contractLineId } = params;
  const nextUnbilled = await tenantScopedTable(trx, tenant, 'recurring_service_periods')
    .where({ tenant, obligation_id: contractLineId })
    .whereNotIn('lifecycle_state', ['billed', 'locked', 'superseded', 'archived'])
    .orderBy('service_period_start', 'asc')
    .first<{ service_period_start: unknown }>('service_period_start');
  if (!nextUnbilled) {
    const latest = await tenantScopedTable(trx, tenant, 'recurring_service_periods')
      .where({ obligation_id: contractLineId }).orderBy('service_period_end', 'desc').first();
    if (latest) return toBoundaryDay(latest.service_period_end);
    const line = await tenantScopedTable(trx, tenant, 'contract_lines').where('contract_line_id', contractLineId).first();
    const assignment = line?.contract_id && await tenantScopedTable(trx, tenant, 'client_contracts')
      .where({ contract_id: line.contract_id, is_active: true }).orderBy('start_date').first();
    if (!assignment) return null; // Unassigned authoring configuration has no priced history.
    let boundary = toPlainDate(toBoundaryDay(assignment.start_date));
    const today = new Date().toISOString().slice(0, 10);
    const months = ({ monthly: 1, quarterly: 3, semi_annually: 6, semiannually: 6, annually: 12, yearly: 12 } as Record<string, number>)[line.billing_frequency];
    if (!months) throw new Error('Materialize a service period before editing quantities for this cadence.');
    while (boundary.toString() < today) boundary = boundary.add({ months });
    return boundary.toString();
  }
  return toBoundaryDay(nextUnbilled.service_period_start);
}

/**
 * Reject an effective boundary that falls inside an already-billed or
 * finalizing period: the change would rewrite an invoiced period. A boundary
 * exactly on a billed period's end is the legal next period.
 */
export async function rejectBilledSeatBoundary(params: {
  trx: Knex.Transaction;
  tenant: string;
  contractLineId: string;
  effectivePeriodStart: string;
}): Promise<string | null> {
  const { trx, tenant, contractLineId, effectivePeriodStart } = params;
  const conflicting = await tenantScopedTable(trx, tenant, 'recurring_service_periods')
    .where({ tenant, obligation_id: contractLineId })
    .whereIn('lifecycle_state', ['billed', 'locked'])
    .where('service_period_end', '>', effectivePeriodStart)
    .first('record_id');
  const db = tenantDb(trx, tenant);
  const history = db.table('invoice_charge_details as detail');
  db.tenantJoin(history, 'contract_line_service_configuration as config', 'detail.config_id', 'config.config_id');
  const billedDetail = await history.where('config.contract_line_id', contractLineId)
    .where('detail.service_period_end', '>=', effectivePeriodStart).first('detail.item_detail_id');
  if (conflicting || billedDetail) {
    return 'That effective date falls inside an already-billed or finalizing service period. Choose the next unbilled service-period boundary instead.';
  }
  return null;
}

/**
 * The seat quantity/unit rate in force for periods starting at the given
 * boundary: the latest revision at/before it, else the live configuration
 * values (base_rate, then custom_rate).
 */
export async function resolveEffectiveSeatPricing(params: {
  trx: Knex.Transaction;
  tenant: string;
  contractLineId: string;
  serviceId: string;
  configId: string;
  boundary: string;
}): Promise<{ quantity: number; unitRateCents: number }> {
  const { trx, tenant, contractLineId, serviceId, configId, boundary } = params;
  const revision = await tenantScopedTable(trx, tenant, 'contract_line_unit_pricing_revisions')
    .where({
      tenant,
      contract_line_id: contractLineId,
      service_id: serviceId,
      config_id: configId,
    })
    .where('effective_period_start', '<=', boundary)
    .orderBy('effective_period_start', 'desc')
    .orderBy('created_at', 'desc')
    .first<{ quantity: number; unit_rate_cents: number | string } | undefined>(
      'quantity',
      'unit_rate_cents',
    );
  if (revision) {
    return {
      quantity: Number(revision.quantity),
      unitRateCents: Number(revision.unit_rate_cents),
    };
  }
  const config = await tenantScopedTable(trx, tenant, 'contract_line_service_configuration')
    .where({ tenant, contract_line_id: contractLineId, service_id: serviceId, config_id: configId })
    .first<{ quantity: number | null; custom_rate: number | string | null } | undefined>(
      'quantity',
      'custom_rate',
    );
  const fixedConfig = await tenantScopedTable(trx, tenant, 'contract_line_service_fixed_config')
    .where({ tenant, config_id: configId })
    .first<{ base_rate: number | string | null } | undefined>('base_rate');
  const catalog = await tenantScopedTable(trx, tenant, 'service_catalog').where('service_id', serviceId).first('default_rate');
  return {
    quantity: Number(config?.quantity ?? 0),
    unitRateCents: Number(fixedConfig?.base_rate ?? config?.custom_rate ?? catalog?.default_rate ?? 0),
  };
}

/** A future boundary must continue a persisted cadence, never an arbitrary date. */
export async function validateProspectivePricingBoundary(trx: Knex.Transaction, tenant: string, lineId: string, boundary: string): Promise<string | null> {
  let day;
  try { day = toPlainDate(boundary); } catch { return 'Choose a valid calendar date at a service-period boundary.'; }
  const db = tenantDb(trx, tenant);
  const line = await db.table('contract_lines').where('contract_line_id', lineId).first();
  if (!line) return 'Contract line not found.';
  const assignments = line.contract_id ? await db.table('client_contracts').where({contract_id: line.contract_id, is_active: true}).select('*') : [];
  if (assignments.length && !assignments.some(a => toBoundaryDay(a.start_date) <= boundary && (!a.end_date || toBoundaryDay(a.end_date) >= boundary))) {
    return 'The contract assignment is not effective at this boundary.';
  }
  const periods = await db.table('recurring_service_periods').where('obligation_id', lineId)
    .whereNotIn('lifecycle_state', ['superseded', 'archived']).orderBy('service_period_start').select('*');
  const known = periods.some(p => toBoundaryDay(p.service_period_start) === boundary || toBoundaryDay(p.service_period_end) === boundary);
  if (known) return rejectBilledSeatBoundary({trx, tenant, contractLineId: lineId, effectivePeriodStart: boundary});
  const last = periods.at(-1);
  if (periods.some(p => toBoundaryDay(p.service_period_start) < boundary && boundary < toBoundaryDay(p.service_period_end))) {
    return 'Choose a service-period boundary; mid-period pricing changes are not supported.';
  }
  const cycles = assignments.length ? await db.table('client_billing_cycles').whereIn('client_id', assignments.map(a => a.client_id))
    .whereNotNull('period_start_date').orderBy('period_start_date', 'desc').select('*') : [];
  const anchor = last?.service_period_start ?? (line.cadence_owner === 'contract' ? assignments[0]?.start_date : cycles[0]?.period_start_date) ?? assignments[0]?.start_date;
  if (!anchor) return assignments.length ? 'Materialize a service period to establish the pricing boundary.' : null;
  const frequency = line.cadence_owner === 'contract' ? line.billing_frequency : cycles[0]?.billing_cycle ?? line.billing_frequency;
  const months = ({monthly: 1, quarterly: 3, semi_annually: 6, semiannually: 6, annually: 12, yearly: 12} as Record<string, number>)[frequency];
  if (!months) return 'Materialize the future service period before changing this billing cadence.';
  const anchorDay = toPlainDate(toBoundaryDay(anchor));
  const distance = (day.year - anchorDay.year) * 12 + day.month - anchorDay.month;
  if (distance % months !== 0 || anchorDay.add({months: distance}).toString() !== boundary) {
    return 'Choose a canonical service-period boundary for this contract cadence.';
  }
  return rejectBilledSeatBoundary({trx, tenant, contractLineId: lineId, effectivePeriodStart: boundary});
}

export interface IScheduleRecurringUnitRevisionParams {
  trx: Knex.Transaction;
  tenant: string;
  userId: string | null;
  contractLineId: string;
  serviceId: string;
  configId: string;
  kind: RecurringUnitKind;
  quantity: number;
  pricePolicy: RecurringPricePolicy;
  /** Required and >= 0 for `override`; must be null/omitted for `catalog`. */
  unitRateCents: number | null;
  effectivePeriodStart: string;
  /**
   * Optimistic-concurrency expectation for the target boundary:
   *  - `undefined`: internal/legacy unconditional upsert (configuration service);
   *  - `null`: the caller loaded the boundary and saw no revision — creation is
   *    expected, so an existing row means another editor created one first and
   *    the write is rejected;
   *  - a number: compare-and-set on the stored pending version.
   */
  expectedVersion?: number | null;
}

export type ScheduleRecurringUnitRevisionResult =
  | { ok: true; revision: IContractLineUnitPricingRevision }
  | { ok: false; error: string };

export interface IScheduleSeatRevisionParams {
  trx: Knex.Transaction;
  tenant: string;
  userId: string | null;
  contractLineId: string;
  serviceId: string;
  configId: string;
  quantity: number;
  unitRateCents: number;
  effectivePeriodStart: string;
}

export type ScheduleSeatRevisionResult = ScheduleRecurringUnitRevisionResult;

async function loadRecurringUnitRevisions(
  trx: Knex.Transaction,
  tenant: string,
  params: { contractLineId: string; serviceId: string; configId: string },
): Promise<RecurringUnitRevisionRow[]> {
  return (await tenantScopedTable(trx, tenant, 'contract_line_unit_pricing_revisions')
    .where({
      tenant,
      contract_line_id: params.contractLineId,
      service_id: params.serviceId,
      config_id: params.configId,
    })
    .orderBy('effective_period_start', 'asc')
    .orderBy('created_at', 'asc')) as unknown as RecurringUnitRevisionRow[];
}

/**
 * Resolve the baseline (no-revision) quantity/rate policy for a recurring unit
 * from its live configuration, honoring kind-specific precedence: an
 * explicitly unit-priced service reads fixed base_rate first; a product reads
 * only the contract override chain and never the wizard placeholder base_rate.
 */
async function loadRecurringUnitBaseline(
  trx: Knex.Transaction,
  tenant: string,
  params: { contractLineId: string; serviceId: string; configId: string; kind: RecurringUnitKind },
) {
  const config = await tenantScopedTable(trx, tenant, 'contract_line_service_configuration')
    .where({
      tenant,
      contract_line_id: params.contractLineId,
      service_id: params.serviceId,
      config_id: params.configId,
    })
    .first<{ quantity: number | null; custom_rate: number | string | null } | undefined>(
      'quantity',
      'custom_rate',
    );
  const serviceLine = await tenantScopedTable(trx, tenant, 'contract_line_services')
    .where({
      tenant,
      contract_line_id: params.contractLineId,
      service_id: params.serviceId,
    })
    .first<{ quantity: number | null; custom_rate: number | string | null } | undefined>(
      'quantity',
      'custom_rate',
    );
  const fixedConfig = await tenantScopedTable(trx, tenant, 'contract_line_service_fixed_config')
    .where({ tenant, config_id: params.configId })
    .first<{ base_rate: number | string | null } | undefined>('base_rate');
  return resolveRecurringUnitBaseline({
    kind: params.kind,
    quantity: config?.quantity ?? serviceLine?.quantity,
    configurationCustomRate: config?.custom_rate,
    serviceLineCustomRate: serviceLine?.custom_rate,
    fixedBaseRate: fixedConfig?.base_rate,
  });
}

/**
 * The full effective (revision-aware) quantity/rate policy in force for periods
 * starting at `boundary`, using the same shared selection rules as billing.
 */
export async function resolveEffectiveRecurringUnitPricingInTransaction(params: {
  trx: Knex.Transaction;
  tenant: string;
  contractLineId: string;
  serviceId: string;
  configId: string;
  kind: RecurringUnitKind;
  boundary: string;
}): Promise<EffectiveRecurringUnitPricing> {
  const baseline = await loadRecurringUnitBaseline(params.trx, params.tenant, {
    contractLineId: params.contractLineId,
    serviceId: params.serviceId,
    configId: params.configId,
    kind: params.kind,
  });
  const rows = await loadRecurringUnitRevisions(params.trx, params.tenant, {
    contractLineId: params.contractLineId,
    serviceId: params.serviceId,
    configId: params.configId,
  });
  return selectEffectiveRecurringUnitPricing({
    boundary: params.boundary,
    baseline,
    revisions: rows.map(toRecurringUnitRevisionCandidate),
  });
}

/**
 * Validates the recurring-unit scope (an explicitly unit-priced Fixed service
 * or a catalog product on a Fixed line), refuses billed boundaries, enforces
 * compare-and-set for pending replacements, records the superseded pending edit
 * in history, and upserts the revision for the boundary.
 */
export async function scheduleRecurringUnitRevisionInTransaction(
  params: IScheduleRecurringUnitRevisionParams,
): Promise<ScheduleRecurringUnitRevisionResult> {
  const {
    trx,
    tenant,
    userId,
    contractLineId,
    serviceId,
    configId,
    kind,
    quantity,
    pricePolicy,
    unitRateCents,
    effectivePeriodStart,
    expectedVersion,
  } = params;

  if (!Number.isInteger(quantity) || quantity < 0) {
    return { ok: false, error: 'Quantity must be a whole number of 0 or more.' };
  }
  if (pricePolicy !== 'override' && pricePolicy !== 'catalog') {
    return { ok: false, error: 'Price policy must be either an explicit override or catalog inheritance.' };
  }
  if (pricePolicy === 'override') {
    if (
      unitRateCents === null ||
      unitRateCents === undefined ||
      !Number.isFinite(unitRateCents) ||
      unitRateCents < 0 ||
      !Number.isInteger(unitRateCents)
    ) {
      return { ok: false, error: 'An explicit unit price override must be a whole number of minor units (cents) of 0 or more.' };
    }
  } else if (unitRateCents !== null && unitRateCents !== undefined) {
    return { ok: false, error: 'Catalog inheritance stores no unit rate; omit the override amount or choose explicit pricing.' };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectivePeriodStart)) {
    return { ok: false, error: 'Effective date must be a calendar date (YYYY-MM-DD) at a service-period boundary.' };
  }

  await lockTenantBilling(trx, tenant);
  const fixedConfig = await tenantScopedTable(trx, tenant, 'contract_line_service_configuration as clsc')
    .where({
      'clsc.tenant': tenant,
      'clsc.contract_line_id': contractLineId,
      'clsc.service_id': serviceId,
      'clsc.config_id': configId,
      'clsc.configuration_type': 'Fixed',
    })
    .innerJoin('contract_line_service_fixed_config as fc', function () { this.on('fc.config_id', 'clsc.config_id').andOn('fc.tenant', 'clsc.tenant'); })
    .first<{ pricing_basis: string | null }>('fc.pricing_basis');
  if (!fixedConfig) {
    return { ok: false, error: 'The selected service is not a Fixed configuration on that contract line.' };
  }
  if (kind === 'service' && fixedConfig.pricing_basis !== 'unit') {
    return {
      ok: false,
      error:
        'Only explicitly unit-priced (recurring seats/units) services can carry scheduled quantity/rate changes. This service uses bundle pricing.',
    };
  }
  if (kind === 'product') {
    const catalogItem = await tenantScopedTable(trx, tenant, 'service_catalog')
      .where({ tenant, service_id: serviceId })
      .first<{ item_kind: string | null } | undefined>('item_kind');
    if (catalogItem?.item_kind !== 'product') {
      return { ok: false, error: 'The selected item is not a recurring catalog product.' };
    }
  }
  const line = await tenantScopedTable(trx, tenant, 'contract_lines')
    .where({ tenant, contract_line_id: contractLineId, contract_line_type: 'Fixed' })
    .first('contract_line_id');
  if (!line) {
    return { ok: false, error: 'The selected contract line is not a Fixed line.' };
  }

  const boundaryConflict = await validateProspectivePricingBoundary(trx, tenant, contractLineId, effectivePeriodStart);
  if (boundaryConflict) {
    return { ok: false, error: boundaryConflict };
  }

  const existing = await tenantScopedTable(trx, tenant, 'contract_line_unit_pricing_revisions')
    .where({
      tenant,
      contract_line_id: contractLineId,
      service_id: serviceId,
      config_id: configId,
      effective_period_start: effectivePeriodStart,
    })
    .first<{
      revision_id: string;
      quantity: number;
      unit_rate_cents: number | string | null;
      price_policy: string | null;
      version: number | string | null;
      created_by: string | null;
      created_at: string | Date | null;
      updated_by: string | null;
      updated_at: string | Date | null;
    }>('revision_id', 'quantity', 'unit_rate_cents', 'price_policy', 'version', 'created_by', 'created_at', 'updated_by', 'updated_at');

  if (existing) {
    const storedVersion = Number(existing.version ?? 1);
    // The caller expected to *create* at an empty boundary, but another editor
    // won the race and a revision now exists: reject rather than silently
    // replacing their edit.
    if (expectedVersion === null) {
      return {
        ok: false,
        error:
          'Another change was created at this effective date by someone else. Reload the period and review the newer values before saving.',
      };
    }
    // A replacement requires a matching version. Legacy/internal writers that
    // omit `expectedVersion` (the configuration service) keep unconditional
    // upsert semantics.
    if (expectedVersion !== undefined && Number(expectedVersion) !== storedVersion) {
      return {
        ok: false,
        error: 'This pending change was updated by someone else. Reload the period and review the newer values before saving.',
      };
    }
    // Append-only audit of the superseded pending edit, preserving both the
    // original author/timestamps and the replacing actor. The canonical row
    // stays the single source billing reads.
    await tenantScopedTable(trx, tenant, 'contract_line_unit_pricing_revision_history').insert({
      tenant,
      revision_id: existing.revision_id,
      contract_line_id: contractLineId,
      service_id: serviceId,
      config_id: configId,
      quantity: Number(existing.quantity),
      unit_rate_cents: existing.unit_rate_cents === null ? null : Number(existing.unit_rate_cents),
      price_policy: existing.price_policy === 'catalog' ? 'catalog' : 'override',
      effective_period_start: effectivePeriodStart,
      version: storedVersion,
      superseded_by: userId ?? 'system',
      recorded_by: userId,
      original_created_by: existing.created_by,
      original_created_at: existing.created_at,
      original_updated_by: existing.updated_by,
      original_updated_at: existing.updated_at,
    });
    const [updated] = await tenantScopedTable(trx, tenant, 'contract_line_unit_pricing_revisions')
      .where({ tenant, revision_id: existing.revision_id })
      .update({
        quantity,
        unit_rate_cents: pricePolicy === 'override' ? unitRateCents : null,
        price_policy: pricePolicy,
        version: storedVersion + 1,
        updated_by: userId,
        updated_at: trx.fn.now(),
        // `created_by`/`created_at` are the original author's and are preserved;
        // replacement attribution lives on `updated_by` and in history.
      })
      .returning('*');
    return { ok: true, revision: updated as unknown as IContractLineUnitPricingRevision };
  }

  // A caller that expected to replace (a version number) but finds no row — or
  // an explicit create-expectation that is satisfied — falls through to insert.
  // Only an explicit version mismatch (a replacement expectation) is stale.
  if (expectedVersion !== null && expectedVersion !== undefined) {
    return {
      ok: false,
      error: 'This pending change no longer exists at that boundary. Reload the period before saving.',
    };
  }

  const [inserted] = await tenantScopedTable(trx, tenant, 'contract_line_unit_pricing_revisions')
    .insert({
      tenant,
      contract_line_id: contractLineId,
      service_id: serviceId,
      config_id: configId,
      quantity,
      unit_rate_cents: pricePolicy === 'override' ? unitRateCents : null,
      price_policy: pricePolicy,
      version: 1,
      effective_period_start: effectivePeriodStart,
      created_by: userId,
      updated_by: userId,
    })
    .returning('*');
  return { ok: true, revision: inserted as unknown as IContractLineUnitPricingRevision };
}

/** Backwards-compatible seat wrapper: unit-priced Fixed service, explicit rate. */
export async function scheduleSeatRevisionInTransaction(
  params: IScheduleSeatRevisionParams,
): Promise<ScheduleSeatRevisionResult> {
  return scheduleRecurringUnitRevisionInTransaction({
    ...params,
    kind: 'service',
    pricePolicy: 'override',
    unitRateCents: params.unitRateCents,
  });
}

export interface IRecurringUnitPricingRevisionListRow {
  revision_id: string;
  quantity: number;
  unit_rate_cents: number | null;
  price_policy: RecurringPricePolicy;
  version: number;
  effective_period_start: string;
  created_by: string | null;
  updated_by: string | null;
  created_at: string | Date | null;
  updated_at: string | Date | null;
}

/**
 * Canonical scheduled revisions for one configuration, earliest boundary first.
 * These are the rows billing reads; a replacement keeps the same revision id
 * and bumps `version`, so the latest row per boundary is authoritative.
 */
export async function listRecurringUnitPricingRevisions(params: {
  trx: Knex.Transaction | Knex;
  tenant: string;
  contractLineId: string;
  serviceId: string;
  configId: string;
}): Promise<IRecurringUnitPricingRevisionListRow[]> {
  const rows = await loadRecurringUnitRevisions(params.trx as Knex.Transaction, params.tenant, {
    contractLineId: params.contractLineId,
    serviceId: params.serviceId,
    configId: params.configId,
  });
  return rows.map((row) => ({
    revision_id: String(row.revision_id),
    quantity: Number(row.quantity),
    unit_rate_cents:
      row.unit_rate_cents === null || row.unit_rate_cents === undefined
        ? null
        : Number(row.unit_rate_cents),
    price_policy: row.price_policy === 'catalog' ? 'catalog' : 'override',
    version: Number(row.version ?? 1),
    effective_period_start: normalizeRecurringBoundary(row.effective_period_start),
    created_by: row.created_by == null ? null : String(row.created_by),
    updated_by: row.updated_by == null ? null : String(row.updated_by),
    created_at: (row.created_at as string | Date | null) ?? null,
    updated_at: (row.updated_at as string | Date | null) ?? null,
  }));
}

export interface IRecurringUnitPricingHistoryRow {
  history_id: string;
  revision_id: string;
  quantity: number;
  unit_rate_cents: number | null;
  price_policy: RecurringPricePolicy;
  effective_period_start: string;
  version: number;
  /** Actor who performed the replacement (the superseding writer). */
  superseded_by: string;
  recorded_by: string | null;
  /** Author of the superseded revision values (may differ from `superseded_by`). */
  original_created_by: string | null;
  original_created_at: string | Date | null;
  original_updated_by: string | null;
  original_updated_at: string | Date | null;
  created_at: string | Date | null;
}

/**
 * Read the append-only superseded-edit log for one configuration, newest first.
 */
export async function listRecurringUnitPricingHistory(params: {
  trx: Knex.Transaction | Knex;
  tenant: string;
  contractLineId: string;
  serviceId: string;
  configId: string;
}): Promise<IRecurringUnitPricingHistoryRow[]> {
  const rows = (await tenantScopedTable(params.trx, params.tenant, 'contract_line_unit_pricing_revision_history')
    .where({
      tenant: params.tenant,
      contract_line_id: params.contractLineId,
      service_id: params.serviceId,
      config_id: params.configId,
    })
    .orderBy('created_at', 'desc')) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    history_id: String(row.history_id),
    revision_id: String(row.revision_id),
    quantity: Number(row.quantity),
    unit_rate_cents: row.unit_rate_cents === null || row.unit_rate_cents === undefined ? null : Number(row.unit_rate_cents),
    price_policy: row.price_policy === 'catalog' ? 'catalog' : 'override',
    effective_period_start: normalizeRecurringBoundary(row.effective_period_start),
    version: Number(row.version ?? 1),
    superseded_by: String(row.superseded_by ?? ''),
    recorded_by: row.recorded_by == null ? null : String(row.recorded_by),
    original_created_by:
      row.original_created_by == null ? null : String(row.original_created_by),
    original_created_at: (row.original_created_at as string | Date | null) ?? null,
    original_updated_by:
      row.original_updated_by == null ? null : String(row.original_updated_by),
    original_updated_at: (row.original_updated_at as string | Date | null) ?? null,
    created_at: (row.created_at as string | Date | null) ?? null,
  }));
}
