import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { resolvePrepaidBlockBusinessDate, toDateOnly } from '../lib/prepaidBlockDates';

/**
 * Keeps contract_line_block_issuances in step with a Prepaid Block line's
 * config and assignment (plan section 5 "Sync"). Called next to every
 * syncRecurringServicePeriodsForContractLine call site.
 *
 * Idempotent: running it twice yields the same rows. Lock order (plan Risk 6):
 * the config row is locked FOR UPDATE first, then issuance rows are read and
 * written; this function never touches hour_blocks rows except a read-only
 * existence check.
 *
 * Rules
 *  - First block: config present, a live assignment, the line has never issued
 *    a block (no invoiced issuance, no non-voided block) and no scheduled
 *    issuance exists -> insert `contract_start` due at
 *    max(client_contracts.start_date, the business date the line was created on).
 *    The business date is the calendar day of line.created_at in the tenant's
 *    effective time zone (resolvePrepaidBlockBusinessDate), never the UTC slice of
 *    the timestamp: a line created at 20:00 EDT is created that EDT day.
 *  - A scheduled `contract_start` issuance follows later edits to the start
 *    date / owning assignment.
 *  - Cancellation: scheduled issuances are cancelled (expiry ones superseded)
 *    when the config is removed, the line or its assignment is gone/inactive,
 *    or the assignment ends before the due date. (Line deletion also cascades
 *    through the issuance FK.)
 *
 * TODO(captain-decision-1): renewal contracts should issue a start block only
 * when trigger_on_renewal is on, and `renewal` issuances are scheduled from the
 * renewal cycle / renewal draft activation. Unconfirmed; deliberately not
 * implemented, so a renewal draft's block line gets a normal contract_start.
 */

function table(conn: Knex | Knex.Transaction, tenant: string, name: string) {
  return tenantDb(conn, tenant).table(name);
}

export type PrepaidBlockIssuanceSyncResult =
  | { action: 'none' }
  | { action: 'scheduled'; issuanceId: string; dueDate: string }
  | { action: 'rescheduled'; issuanceId: string; dueDate: string }
  | { action: 'cancelled'; count: number };

async function cancelScheduledIssuances(
  trx: Knex.Transaction,
  tenant: string,
  contractLineId: string,
  reason: string,
  options: { onlyDueAfter?: string } = {},
): Promise<number> {
  const now = new Date().toISOString();
  const apply = (kinds: 'expiry' | 'other') => {
    const q = table(trx, tenant, 'contract_line_block_issuances')
      .where({ contract_line_id: contractLineId, status: 'scheduled' });
    if (kinds === 'expiry') q.where({ trigger_kind: 'expiry' });
    else q.whereNot({ trigger_kind: 'expiry' });
    if (options.onlyDueAfter) q.where('due_date', '>', options.onlyDueAfter);
    return q.update({
      status: kinds === 'expiry' ? 'superseded' : 'cancelled',
      cancel_reason: reason,
      updated_at: now,
    });
  };
  return (await apply('expiry')) + (await apply('other'));
}

export async function syncPrepaidBlockIssuancesForContractLine(
  trx: Knex.Transaction,
  tenant: string,
  contractLineId: string,
): Promise<PrepaidBlockIssuanceSyncResult> {
  // Config lock first (also serializes concurrent syncs for the line).
  const config = await table(trx, tenant, 'contract_line_prepaid_blocks')
    .where({ contract_line_id: contractLineId })
    .forUpdate()
    .first('contract_line_id');

  const db = tenantDb(trx, tenant);
  const lineQuery = db.table('contract_lines as cl');
  db.tenantJoin(lineQuery, 'contracts as ct', 'ct.contract_id', 'cl.contract_id', { type: 'left' });
  const line = await lineQuery
    .andWhere('cl.contract_line_id', contractLineId)
    .first('cl.contract_line_id as contract_line_id', 'cl.contract_id as contract_id', 'cl.created_at as created_at', 'ct.status as contract_status');

  if (!config) {
    const count = await cancelScheduledIssuances(trx, tenant, contractLineId, 'Prepaid block configuration removed from the line');
    return count > 0 ? { action: 'cancelled', count } : { action: 'none' };
  }
  if (!line) {
    const count = await cancelScheduledIssuances(trx, tenant, contractLineId, 'Contract line deleted');
    return count > 0 ? { action: 'cancelled', count } : { action: 'none' };
  }

  // The live assignment (one active assignment per contract in practice).
  const assignment = line.contract_status && !['draft', 'terminated', 'archived'].includes(line.contract_status)
    ? await table(trx, tenant, 'client_contracts')
      .where({ contract_id: line.contract_id, is_active: true })
      .orderBy('start_date', 'asc')
      .first('client_contract_id', 'client_id', 'start_date', 'end_date')
    : null;

  if (!assignment) {
    const count = await cancelScheduledIssuances(trx, tenant, contractLineId, 'Contract line has no active assignment');
    return count > 0 ? { action: 'cancelled', count } : { action: 'none' };
  }

  const endDate = toDateOnly(assignment.end_date);
  let cancelled = 0;
  if (endDate) {
    cancelled = await cancelScheduledIssuances(
      trx, tenant, contractLineId, 'Contract ends before the block is due', { onlyDueAfter: endDate },
    );
  }

  const scheduled = await table(trx, tenant, 'contract_line_block_issuances')
    .where({ contract_line_id: contractLineId, status: 'scheduled' })
    .first('issuance_id', 'trigger_kind', 'due_date', 'client_contract_id');

  const startDate = toDateOnly(assignment.start_date);
  const createdDate = line.created_at ? await resolvePrepaidBlockBusinessDate(trx, tenant, line.created_at) : null;
  const firstDue = [startDate, createdDate].filter((d): d is string => !!d).sort().pop() ?? null;

  if (scheduled) {
    // Keep the not-yet-invoiced start obligation aligned with start-date edits.
    if (scheduled.trigger_kind === 'contract_start' && firstDue && (endDate == null || firstDue <= endDate)
      && (toDateOnly(scheduled.due_date) !== firstDue || scheduled.client_contract_id !== assignment.client_contract_id)) {
      await table(trx, tenant, 'contract_line_block_issuances')
        .where({ issuance_id: scheduled.issuance_id })
        .update({
          due_date: firstDue,
          client_contract_id: assignment.client_contract_id,
          client_id: assignment.client_id,
          updated_at: new Date().toISOString(),
        });
      return { action: 'rescheduled', issuanceId: scheduled.issuance_id, dueDate: firstDue };
    }
    return cancelled > 0 ? { action: 'cancelled', count: cancelled } : { action: 'none' };
  }

  if (!firstDue || (endDate && firstDue > endDate)) {
    return cancelled > 0 ? { action: 'cancelled', count: cancelled } : { action: 'none' };
  }

  // "Never issued a block": an invoiced issuance or any non-voided block for the line.
  const invoiced = await table(trx, tenant, 'contract_line_block_issuances')
    .where({ contract_line_id: contractLineId, status: 'invoiced' })
    .first('issuance_id');
  if (invoiced) return cancelled > 0 ? { action: 'cancelled', count: cancelled } : { action: 'none' };
  const hasBlock = await table(trx, tenant, 'hour_blocks')
    .where({ contract_line_id: contractLineId })
    .whereNot({ status: 'voided' })
    .first('block_id');
  if (hasBlock) return cancelled > 0 ? { action: 'cancelled', count: cancelled } : { action: 'none' };

  const issuanceId = uuidv4();
  await table(trx, tenant, 'contract_line_block_issuances').insert({
    tenant,
    issuance_id: issuanceId,
    contract_line_id: contractLineId,
    client_contract_id: assignment.client_contract_id,
    client_id: assignment.client_id,
    trigger_kind: 'contract_start',
    due_date: firstDue,
    status: 'scheduled',
  });
  return { action: 'scheduled', issuanceId, dueDate: firstDue };
}

/** Contract-level callers (assignment create/update/activate, wizard save). */
export async function syncPrepaidBlockIssuancesForContract(
  trx: Knex.Transaction,
  tenant: string,
  contractId: string,
): Promise<void> {
  const lineIds: string[] = await table(trx, tenant, 'contract_lines')
    .where({ contract_id: contractId })
    .pluck('contract_line_id');
  for (const contractLineId of lineIds) {
    await syncPrepaidBlockIssuancesForContractLine(trx, tenant, contractLineId);
  }
}
