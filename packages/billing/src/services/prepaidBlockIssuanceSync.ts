import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { resolvePrepaidBlockBusinessDate, toDateOnly } from '../lib/prepaidBlockDates';
import { supersedeScheduledExpiryForRenewal } from './prepaidBlockLifecycleService';

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
 *    client_contracts.start_date, unless the line was added to an already-running
 *    contract (line.created_at more than a short tolerance after the contract's own
 *    created_at), in which case max(start_date, the business date it was added).
 *    A line created with its contract never depends on created_at, so a 20:00 EDT
 *    contract with that day's start date is due on the start date even when the
 *    tenant has no time zone (UTC fallback). The added date is the calendar day of
 *    line.created_at in the tenant's effective time zone (resolvePrepaidBlockBusinessDate).
 *  - A scheduled `contract_start` issuance follows later edits to the start
 *    date / owning assignment.
 *  - Renewal contracts (see isRenewalContract): "at contract renewal" is an explicit trigger. With
 *    trigger_on_renewal on, the line schedules exactly one `renewal` issuance due on the renewal
 *    assignment's start date, whether or not it inherited live blocks through re-ownership
 *    (prepaidBlockRenewalService; inherited blocks keep running). A scheduled (inherited) expiry
 *    issuance is superseded by it, like a usage follow-on supersedes one. With the trigger off nothing
 *    is issued. Never `contract_start`.
 *  - Cadence mode (issue_mode = 'cadence'): no issuances at all; scheduled ones are cancelled.
 *  - Cancellation: scheduled issuances of EVERY kind (expiry ones superseded, the
 *    rest cancelled) are cancelled when the config is removed, the line or its
 *    assignment is gone/inactive, or the assignment ends before the due date.
 *    (Line deletion also cascades through the issuance FK.)
 */

function table(conn: Knex | Knex.Transaction, tenant: string, name: string) {
  return tenantDb(conn, tenant).table(name);
}

/** A wizard/API save creates the contract and its lines within moments of each other. */
const LINE_WITH_CONTRACT_TOLERANCE_MS = 10 * 60 * 1000;

function isAddedAfterContract(lineCreatedAt: unknown, contractCreatedAt: unknown): boolean {
  if (!lineCreatedAt || !contractCreatedAt) return false;
  const line = new Date(lineCreatedAt as any).getTime();
  const contract = new Date(contractCreatedAt as any).getTime();
  if (Number.isNaN(line) || Number.isNaN(contract)) return false;
  return line - contract > LINE_WITH_CONTRACT_TOLERANCE_MS;
}

/**
 * A contract is a renewal contract when it was created as a renewal draft. The durable marker is
 * `contracts.renewal_of_contract_id`, written by createRenewalDraftForQueueItem (and back-filled by its
 * migration). The source assignment's `created_draft_contract_id` link is also honoured, but it is
 * not durable on its own: processRenewalQueueHandler nulls it on every cycle change.
 */
export async function isRenewalContract(
  trx: Knex | Knex.Transaction,
  tenant: string,
  contractId: string,
): Promise<boolean> {
  const marked = await table(trx, tenant, 'contracts')
    .where({ contract_id: contractId })
    .whereNotNull('renewal_of_contract_id')
    .first('contract_id');
  if (marked) return true;
  const source = await table(trx, tenant, 'client_contracts')
    .where({ created_draft_contract_id: contractId })
    .first('client_contract_id');
  return Boolean(source);
}

export type PrepaidBlockIssuanceSyncResult =
  | { action: 'none' }
  | { action: 'scheduled'; issuanceId: string; dueDate: string }
  | { action: 'rescheduled'; issuanceId: string; dueDate: string }
  | { action: 'cancelled'; count: number };

export async function cancelScheduledIssuances(
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
    .first('contract_line_id', 'trigger_on_renewal', 'issue_mode');

  // A cadence block line issues no consumption issuances: its blocks are recurring service periods
  // (plan D2/D3). Switching a line to cadence cancels the ones still scheduled; live blocks keep running.
  if (config?.issue_mode === 'cadence') {
    const count = await cancelScheduledIssuances(trx, tenant, contractLineId, 'Prepaid block is issued every billing period');
    return count > 0 ? { action: 'cancelled', count } : { action: 'none' };
  }

  const db = tenantDb(trx, tenant);
  const lineQuery = db.table('contract_lines as cl');
  db.tenantJoin(lineQuery, 'contracts as ct', 'ct.contract_id', 'cl.contract_id', { type: 'left' });
  const line = await lineQuery
    .andWhere('cl.contract_line_id', contractLineId)
    .first('cl.contract_line_id as contract_line_id', 'cl.contract_id as contract_id', 'cl.created_at as created_at', 'ct.created_at as contract_created_at', 'ct.status as contract_status');

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
    .first('issuance_id', 'trigger_kind', 'due_date', 'client_contract_id', 'source_block_id');

  // A renewal contract's first block is a `renewal` issuance and only with trigger_on_renewal.
  const renewalContract = await isRenewalContract(trx, tenant, line.contract_id);

  const startDate = toDateOnly(assignment.start_date);
  // Only a line added to an already-running contract is due on the day it was added.
  // A line that came with the contract (created with it, within the tolerance, or before it)
  // is due on the contract start date, whatever business date its created_at falls on.
  const addedToRunningContract = isAddedAfterContract(line.created_at, line.contract_created_at);
  const createdDate = addedToRunningContract ? await resolvePrepaidBlockBusinessDate(trx, tenant, line.created_at) : null;
  const firstDue = [startDate, createdDate].filter((d): d is string => !!d).sort().pop() ?? null;
  const unchanged = (): PrepaidBlockIssuanceSyncResult => (cancelled > 0 ? { action: 'cancelled', count: cancelled } : { action: 'none' });

  if (renewalContract) {
    return syncRenewalContractLine(trx, tenant, {
      contractLineId, config, assignment, scheduled, firstDue, endDate, cancelled,
    });
  }

  // "Never issued a block": an invoiced issuance or any non-voided block for the line.
  const neverIssued = async (): Promise<boolean> => {
    const invoiced = await table(trx, tenant, 'contract_line_block_issuances')
      .where({ contract_line_id: contractLineId, status: 'invoiced' })
      .first('issuance_id');
    if (invoiced) return false;
    const hasBlock = await table(trx, tenant, 'hour_blocks')
      .where({ contract_line_id: contractLineId })
      .whereNot({ status: 'voided' })
      .first('block_id');
    return !hasBlock;
  };

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
    return unchanged();
  }

  if (!firstDue || (endDate && firstDue > endDate)) return unchanged();
  if (!(await neverIssued())) return unchanged();

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

/**
 * Start-block sync of a renewal contract's line (see the header rules). The start obligation is the
 * line's only `renewal` issuance for this assignment while nothing on the line has been invoiced;
 * a cycle-rollover renewal issuance is a second one and is never mistaken for it. A renewal issuance
 * recorded for the start date in ANY status (including a voided-and-cancelled one) is not repeated.
 */
async function syncRenewalContractLine(
  trx: Knex.Transaction,
  tenant: string,
  input: {
    contractLineId: string;
    config: { trigger_on_renewal?: boolean };
    assignment: { client_contract_id: string; client_id: string };
    scheduled: { issuance_id: string; trigger_kind: string; due_date: unknown; client_contract_id: string } | undefined;
    firstDue: string | null;
    endDate: string | null;
    cancelled: number;
  },
): Promise<PrepaidBlockIssuanceSyncResult> {
  const { contractLineId, config, assignment, scheduled, firstDue, endDate, cancelled } = input;
  const unchanged = (): PrepaidBlockIssuanceSyncResult => (cancelled > 0 ? { action: 'cancelled', count: cancelled } : { action: 'none' });
  const now = new Date().toISOString();

  const renewals: Array<{ issuance_id: string; status: string; due_date: unknown }> = await table(trx, tenant, 'contract_line_block_issuances')
    .where({ contract_line_id: contractLineId, client_contract_id: assignment.client_contract_id, trigger_kind: 'renewal' })
    .select('issuance_id', 'status', 'due_date');
  const anyInvoiced = await table(trx, tenant, 'contract_line_block_issuances')
    .where({ contract_line_id: contractLineId, status: 'invoiced' })
    .first('issuance_id');
  const startObligation = scheduled && scheduled.trigger_kind === 'renewal' && renewals.length === 1 && !anyInvoiced
    ? scheduled
    : null;

  if (!config.trigger_on_renewal) {
    // Trigger off: no start issuance; the inherited blocks just run.
    if (startObligation) {
      await table(trx, tenant, 'contract_line_block_issuances')
        .where({ issuance_id: startObligation.issuance_id })
        .update({ status: 'cancelled', cancel_reason: 'trigger_on_renewal was switched off', updated_at: now });
      return { action: 'cancelled', count: cancelled + 1 };
    }
    return unchanged();
  }

  if (startObligation) {
    if (firstDue && (endDate == null || firstDue <= endDate)
      && (toDateOnly(startObligation.due_date) !== firstDue || startObligation.client_contract_id !== assignment.client_contract_id)) {
      await table(trx, tenant, 'contract_line_block_issuances')
        .where({ issuance_id: startObligation.issuance_id })
        .update({ due_date: firstDue, client_contract_id: assignment.client_contract_id, client_id: assignment.client_id, updated_at: now });
      return { action: 'rescheduled', issuanceId: startObligation.issuance_id, dueDate: firstDue };
    }
    return unchanged();
  }

  if (!firstDue || (endDate && firstDue > endDate)) return unchanged();
  const alreadyIssued = renewals.some((r) => r.status === 'invoiced' || toDateOnly(r.due_date) === firstDue);
  if (alreadyIssued) return unchanged();
  // Another open issuance blocks the insert, except an expiry one: the renewal block is the newer block.
  if (scheduled && scheduled.trigger_kind !== 'expiry') return unchanged();
  const replaced = scheduled ? await supersedeScheduledExpiryForRenewal(trx, tenant, contractLineId) : null;

  const issuanceId = uuidv4();
  await table(trx, tenant, 'contract_line_block_issuances').insert({
    tenant,
    issuance_id: issuanceId,
    contract_line_id: contractLineId,
    client_contract_id: assignment.client_contract_id,
    client_id: assignment.client_id,
    trigger_kind: 'renewal',
    due_date: firstDue,
    status: 'scheduled',
    source_block_id: replaced?.sourceBlockId ?? null,
  });
  return { action: 'scheduled', issuanceId, dueDate: firstDue };
}

/**
 * After a line switches from cadence back to consumption mode (plan D9): schedule a
 * `contract_start`-style issuance, unless a live block still covers today (it runs to its own
 * expiry, and the configured triggers take over from there) or an issuance is already open.
 * The block is due today, or at the assignment start if that is still ahead.
 */
export async function scheduleStartIssuanceAfterCadenceSwitch(
  trx: Knex.Transaction,
  tenant: string,
  contractLineId: string,
): Promise<PrepaidBlockIssuanceSyncResult> {
  const today = await resolvePrepaidBlockBusinessDate(trx, tenant);
  const open = await table(trx, tenant, 'contract_line_block_issuances')
    .where({ contract_line_id: contractLineId, status: 'scheduled' })
    .first('issuance_id');
  if (open) return { action: 'none' };

  const covering = await table(trx, tenant, 'hour_blocks')
    .where({ contract_line_id: contractLineId })
    .whereIn('status', ['active', 'pending'])
    .where((b) => b.whereNull('valid_from').orWhere('valid_from', '<=', today))
    .where((b) => b.whereNull('expiration_date').orWhere('expiration_date', '>=', today))
    .first('block_id');
  if (covering) return { action: 'none' };

  const lineQuery = table(trx, tenant, 'contract_lines as cl');
  const db = tenantDb(trx, tenant);
  db.tenantJoin(lineQuery, 'contracts as ct', 'ct.contract_id', 'cl.contract_id', { type: 'left' });
  const line = await lineQuery
    .andWhere('cl.contract_line_id', contractLineId)
    .first('cl.contract_id as contract_id', 'ct.status as contract_status');
  if (!line || !line.contract_status || ['draft', 'terminated', 'archived'].includes(line.contract_status)) {
    return { action: 'none' };
  }
  // A renewal contract never issues `contract_start`; its renewal trigger owns that block.
  if (await isRenewalContract(trx, tenant, line.contract_id)) return { action: 'none' };
  const assignment = await table(trx, tenant, 'client_contracts')
    .where({ contract_id: line.contract_id, is_active: true })
    .orderBy('start_date', 'asc')
    .first('client_contract_id', 'client_id', 'start_date', 'end_date');
  if (!assignment) return { action: 'none' };

  const startDate = toDateOnly(assignment.start_date);
  const endDate = toDateOnly(assignment.end_date);
  const dueDate = startDate && startDate > today ? startDate : today;
  if (endDate && dueDate > endDate) return { action: 'none' };

  const issuanceId = uuidv4();
  await table(trx, tenant, 'contract_line_block_issuances').insert({
    tenant,
    issuance_id: issuanceId,
    contract_line_id: contractLineId,
    client_contract_id: assignment.client_contract_id,
    client_id: assignment.client_id,
    trigger_kind: 'contract_start',
    due_date: dueDate,
    status: 'scheduled',
  });
  return { action: 'scheduled', issuanceId, dueDate };
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
