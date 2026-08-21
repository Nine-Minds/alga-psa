'use server';

import type { Knex } from 'knex';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { withAuth, hasPermission } from '@alga-psa/auth';
import type { ContractLineSelectionReason } from '@alga-psa/types';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { getEligibleContractLines } from '../lib/contractLineDisambiguation';

/**
 * The unresolved-item review queue and its two remedies (F068, F069, F137–F142).
 *
 * An "unresolved" item is a time entry or usage record the engine could not
 * attach to a contract line. The engine has always known *why* — 0 eligible
 * lines versus more than one — and written the reason only to `console.info`.
 * That distinction is the whole design here, because the two cases deserve
 * opposite treatment:
 *
 *   uncovered  — no contract covers the service. Catalog rate is honest.
 *   ambiguous  — a contract does cover it, so there is a negotiated rate and
 *                catalog pricing is simply wrong.
 *
 * So an ambiguous item gets two ways out and no silent third: assign a contract
 * line (F138 — it then bills at contract pricing, with rate, rounding,
 * minimums, and overtime), or explicitly accept catalog pricing for that item
 * (F139). Usage records get exactly the same treatment as time entries (F141).
 */

export type UnresolvedChargeActionError = ActionMessageError | ActionPermissionError;

export type UnresolvedRecordKind = 'time_entry' | 'usage_record';

export interface EligibleContractLineOption {
  contractLineId: string;
  contractLineName: string;
  contractName: string | null;
  hasBucketOverlay: boolean;
}

export interface UnresolvedChargeReviewRow {
  kind: UnresolvedRecordKind;
  recordId: string;
  clientId: string;
  serviceId: string | null;
  serviceName: string | null;
  workDate: string | null;
  /** Minutes for a time entry; quantity for a usage record. */
  quantity: number;
  /**
   * Why no contract line was chosen. `no_match` means nothing covers the
   * service; anything else means something does and we could not pick.
   */
  reason: ContractLineSelectionReason | null;
  /** True when the item may be billed at catalog rate without further decision. */
  billsAtCatalogRate: boolean;
  catalogPricingAcknowledgedAt: string | null;
  eligibleContractLines: EligibleContractLineOption[];
}

function unresolvedActionErrorFrom(error: unknown): UnresolvedChargeActionError | null {
  if (error instanceof Error && error.message.includes('Permission denied')) {
    return permissionError(error.message);
  }
  return null;
}

async function assertBillingRead(user: any): Promise<void> {
  if (!(await hasPermission(user, 'billing', 'read'))) {
    throw new Error('Permission denied: Cannot read unresolved billing items');
  }
}

async function assertBillingUpdate(user: any): Promise<void> {
  if (!(await hasPermission(user, 'billing', 'update'))) {
    throw new Error('Permission denied: Cannot resolve billing items');
  }
}

/**
 * pg returns timestamps as Date objects; `String(date)` yields a locale string
 * ("Sat May 10 2025 …") that the date-range helpers slice into nonsense. Always
 * normalise to an ISO date.
 */
function toIsoDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

const RECORD_SPECS: Record<
  UnresolvedRecordKind,
  { table: string; idColumn: string; dateColumn: string }
> = {
  time_entry: { table: 'time_entries', idColumn: 'entry_id', dateColumn: 'start_time' },
  usage_record: { table: 'usage_tracking', idColumn: 'usage_id', dateColumn: 'usage_date' },
};

/**
 * Items in the review queue for a client over a window (F068).
 *
 * Includes the eligible contract lines for each ambiguous item, because the
 * remedy the biller needs is on the same row as the problem — a queue that only
 * reports is a list of complaints.
 */
export const getUnresolvedChargeReview = withAuth(async (
  user,
  { tenant },
  input: { clientId: string; windowStart: string; windowEnd: string },
): Promise<UnresolvedChargeReviewRow[] | UnresolvedChargeActionError> => {
  try {
    await assertBillingRead(user);
    const { knex } = await createTenantKnex();
    const db = tenantDb(knex, tenant);

    const timeQuery = db.table('time_entries as te');
    db.tenantJoin(timeQuery, 'service_catalog as sc', 'sc.service_id', 'te.service_id', {
      type: 'left',
    });
    db.tenantJoin(timeQuery, 'tickets as t', 't.ticket_id', 'te.work_item_id', { type: 'left' });
    db.tenantJoin(timeQuery, 'project_tasks as pt', 'pt.task_id', 'te.work_item_id', {
      type: 'left',
    });
    db.tenantJoin(timeQuery, 'project_phases as pp', 'pp.phase_id', 'pt.phase_id', {
      type: 'left',
    });
    db.tenantJoin(timeQuery, 'projects as p', 'p.project_id', 'pp.project_id', { type: 'left' });

    const timeRows = await timeQuery
      .whereNull('te.contract_line_id')
      .where('te.invoiced', false)
      .whereNotNull('te.service_id')
      .where('te.billable_duration', '>', 0)
      .where('te.start_time', '>=', input.windowStart)
      .where('te.start_time', '<', input.windowEnd)
      .where(function (this: Knex.QueryBuilder) {
        this.where('t.client_id', input.clientId).orWhere('p.client_id', input.clientId);
      })
      .select(
        'te.entry_id',
        'te.service_id',
        'te.start_time',
        'te.billable_duration',
        'te.contract_line_unresolved_reason',
        'te.catalog_pricing_acknowledged_at',
        'sc.service_name',
      );

    const usageQuery = db.table('usage_tracking as ut');
    db.tenantJoin(usageQuery, 'service_catalog as sc', 'sc.service_id', 'ut.service_id', {
      type: 'left',
    });
    const usageRows = await usageQuery
      .where('ut.client_id', input.clientId)
      .whereNull('ut.contract_line_id')
      .where('ut.invoiced', false)
      .whereNotNull('ut.service_id')
      .where('ut.usage_date', '>=', input.windowStart)
      .where('ut.usage_date', '<', input.windowEnd)
      .select(
        'ut.usage_id',
        'ut.service_id',
        'ut.usage_date',
        'ut.quantity',
        'ut.contract_line_unresolved_reason',
        'ut.catalog_pricing_acknowledged_at',
        'sc.service_name',
      );

    const rows: UnresolvedChargeReviewRow[] = [];

    const addRow = async (
      kind: UnresolvedRecordKind,
      recordId: string,
      serviceId: string | null,
      serviceName: string | null,
      workDate: string | null,
      quantity: number,
      reason: ContractLineSelectionReason | null,
      acknowledgedAt: string | null,
    ) => {
      // Eligible lines are recomputed rather than cached: a contract may have
      // been authored since the reason was recorded, which is precisely the
      // case a reviewing biller wants to see resolved.
      const eligible = serviceId
        ? await getEligibleContractLines(
            knex,
            tenant,
            input.clientId,
            serviceId,
            workDate ?? undefined,
          )
        : [];

      rows.push({
        kind,
        recordId,
        clientId: input.clientId,
        serviceId,
        serviceName,
        workDate,
        quantity,
        // Recompute the reason from what is eligible now; the persisted value is
        // the last generation's answer and may be stale.
        reason: eligible.length === 0 ? 'no_match' : reason ?? 'ambiguous',
        billsAtCatalogRate: eligible.length === 0 || Boolean(acknowledgedAt),
        catalogPricingAcknowledgedAt: toIsoDate(acknowledgedAt),
        eligibleContractLines: eligible.map((line) => ({
          contractLineId: line.client_contract_line_id,
          contractLineName: line.contract_line_name || 'Unnamed contract line',
          contractName: line.contract_name ?? null,
          hasBucketOverlay: Boolean(line.bucket_overlay?.config_id),
        })),
      });
    };

    for (const row of timeRows) {
      await addRow(
        'time_entry',
        row.entry_id,
        row.service_id ?? null,
        row.service_name ?? null,
        toIsoDate(row.start_time),
        Number(row.billable_duration ?? 0),
        (row.contract_line_unresolved_reason as ContractLineSelectionReason | null) ?? null,
        row.catalog_pricing_acknowledged_at ?? null,
      );
    }
    for (const row of usageRows) {
      await addRow(
        'usage_record',
        row.usage_id,
        row.service_id ?? null,
        row.service_name ?? null,
        toIsoDate(row.usage_date),
        Number(row.quantity ?? 0),
        (row.contract_line_unresolved_reason as ContractLineSelectionReason | null) ?? null,
        row.catalog_pricing_acknowledged_at ?? null,
      );
    }

    return rows;
  } catch (error) {
    const expected = unresolvedActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

/**
 * Assign a contract line to an unresolved item (F069, F138).
 *
 * After this the item is no longer unresolved at all: it bills through the
 * normal contract path, which is what brings back the negotiated rate,
 * rounding, minimums, overtime, and pricing schedule that catalog pricing
 * ignores.
 */
export const assignContractLineToUnresolvedItem = withAuth(async (
  user,
  { tenant },
  input: { kind: UnresolvedRecordKind; recordId: string; contractLineId: string },
): Promise<{ success: true } | UnresolvedChargeActionError> => {
  try {
    await assertBillingUpdate(user);
    const { knex } = await createTenantKnex();
    const spec = RECORD_SPECS[input.kind];

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const db = tenantDb(trx, tenant);
      const record = await db
        .table(spec.table)
        .where({ [spec.idColumn]: input.recordId })
        .first('service_id', 'invoiced');
      if (!record) {
        return actionError('That item no longer exists.');
      }
      if (record.invoiced) {
        return actionError('That item has already been invoiced.');
      }

      const line = await db
        .table('contract_lines')
        .where({ contract_line_id: input.contractLineId })
        .first('contract_line_id');
      if (!line) {
        return actionError('That contract line no longer exists.');
      }

      await db
        .table(spec.table)
        .where({ [spec.idColumn]: input.recordId })
        .update({
          contract_line_id: input.contractLineId,
          contract_line_source: 'explicit',
          contract_line_unresolved_reason: null,
          // Assigning a line supersedes any earlier catalog-pricing decision:
          // the item now has contract pricing, so the acceptance is moot and
          // leaving it would be a stale record of a decision no longer in force.
          catalog_pricing_acknowledged_at: null,
          catalog_pricing_acknowledged_by: null,
          updated_at: knex.fn.now(),
        });

      return { success: true as const };
    });
  } catch (error) {
    const expected = unresolvedActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

/**
 * Accept catalog pricing for one ambiguous item (F139).
 *
 * The item still bills at `service_catalog.default_rate`, ignoring the
 * contract's rate, rounding, minimums, overtime, and pricing schedule — the
 * difference from before is that a person decided that, on the record, for this
 * item.
 */
export const acknowledgeCatalogPricing = withAuth(async (
  user,
  { tenant },
  input: { kind: UnresolvedRecordKind; recordId: string; accepted: boolean },
): Promise<{ success: true } | UnresolvedChargeActionError> => {
  try {
    await assertBillingUpdate(user);
    const { knex } = await createTenantKnex();
    const spec = RECORD_SPECS[input.kind];

    await withTransaction(knex, async (trx: Knex.Transaction) => {
      await tenantDb(trx, tenant)
        .table(spec.table)
        .where({ [spec.idColumn]: input.recordId })
        .update({
          catalog_pricing_acknowledged_at: input.accepted ? knex.fn.now() : null,
          catalog_pricing_acknowledged_by: input.accepted ? user.user_id : null,
          updated_at: knex.fn.now(),
        });
    });

    return { success: true };
  } catch (error) {
    const expected = unresolvedActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});
