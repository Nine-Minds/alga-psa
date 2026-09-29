import { Knex } from 'knex';
import { toPlainDate } from '@alga-psa/core';
import { lockTenantBilling } from './billingMutationLock';
import { tenantDb } from '@alga-psa/db';
import type { IContractLineUnitPricingRevision } from '@alga-psa/types';

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

export type ScheduleSeatRevisionResult =
  | { ok: true; revision: IContractLineUnitPricingRevision }
  | { ok: false; error: string };

/**
 * Validates the seat scope (explicitly unit-priced Fixed service on a Fixed
 * line), refuses billed boundaries, and upserts the revision for the boundary.
 */
export async function scheduleSeatRevisionInTransaction(
  params: IScheduleSeatRevisionParams,
): Promise<ScheduleSeatRevisionResult> {
  const {
    trx,
    tenant,
    userId,
    contractLineId,
    serviceId,
    configId,
    quantity,
    unitRateCents,
    effectivePeriodStart,
  } = params;

  if (!Number.isInteger(quantity) || quantity < 0) {
    return { ok: false, error: 'Quantity must be a whole number of 0 or more.' };
  }
  if (!Number.isFinite(unitRateCents) || unitRateCents < 0 || !Number.isInteger(unitRateCents)) {
    return { ok: false, error: 'Unit rate must be a whole number of minor units (cents) of 0 or more.' };
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
  if (fixedConfig.pricing_basis !== 'unit') {
    return {
      ok: false,
      error:
        'Only explicitly unit-priced (recurring seats/units) services can carry scheduled quantity/rate changes. This service uses bundle pricing.',
    };
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
    .first<{ revision_id: string }>('revision_id');

  if (existing) {
    const [updated] = await tenantScopedTable(trx, tenant, 'contract_line_unit_pricing_revisions')
      .where({ tenant, revision_id: existing.revision_id })
      .update({
        quantity,
        unit_rate_cents: unitRateCents,
        created_by: userId,
      })
      .returning('*');
    return { ok: true, revision: updated as unknown as IContractLineUnitPricingRevision };
  }

  const [inserted] = await tenantScopedTable(trx, tenant, 'contract_line_unit_pricing_revisions')
    .insert({
      tenant,
      contract_line_id: contractLineId,
      service_id: serviceId,
      config_id: configId,
      quantity,
      unit_rate_cents: unitRateCents,
      effective_period_start: effectivePeriodStart,
      created_by: userId,
    })
    .returning('*');
  return { ok: true, revision: inserted as unknown as IContractLineUnitPricingRevision };
}
