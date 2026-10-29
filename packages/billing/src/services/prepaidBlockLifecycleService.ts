import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { reconcileLineAllocations } from '@alga-psa/shared/billingClients/hourBlockService';
import { computePrepaidBlockAnniversaryDate, toDateOnly } from '../lib/prepaidBlockDates';

/**
 * Invoice-lifecycle helpers for Prepaid Block (contract-issued) hour blocks
 * (plan section 4 "Lifecycle hooks"). Pure database logic, no server-action or
 * UI dependencies, so the settlement service and the invoice actions share it.
 *
 * Lock discipline (plan Risk 6): config rows, then issuance rows, then
 * hour_blocks (canonical block_id order). Every entry point that will write a
 * contract block takes `lockPrepaidBlockOwnersForInvoice` first.
 */

function table(conn: Knex | Knex.Transaction, tenant: string, name: string) {
  return tenantDb(conn, tenant).table(name);
}

/** Date-driven kinds are still owed after their invoice goes away; usage-driven and manual ones are not. */
const REDUE_TRIGGER_KINDS = new Set(['contract_start', 'expiry', 'renewal']);

/**
 * `cancel_reason` stamped on a source block's expiry issuance when a usage-triggered follow-on
 * (exhaustion/threshold) replaces it. Reversal matches on it so only that supersession is undone.
 */
export const EXPIRY_REPLACED_BY_USAGE_BLOCK_REASON = 'A usage-triggered block replaces the expiry issuance';

/**
 * Same, for a `renewal` issuance (cycle rollover, or the first block of a renewal contract) that
 * replaces the line's scheduled expiry issuance: the renewal block is the newer block. Voiding the
 * renewal block restores the expiry issuance (restoreSourceBlockExpiryIssuance).
 */
export const EXPIRY_REPLACED_BY_RENEWAL_BLOCK_REASON = 'A renewal block replaces the expiry issuance';

export interface InvoiceLinkedContractBlockOwners {
  contractLineIds: string[];
  issuanceIds: string[];
}

/**
 * Takes the config-row then issuance-row locks for every contract block linked
 * to the invoice (deterministic id order), so the block locks that follow are
 * always acquired after them. Cheap no-op for invoices without contract blocks.
 */
export async function lockPrepaidBlockOwnersForInvoice(
  trx: Knex.Transaction,
  tenant: string,
  invoiceId: string,
): Promise<InvoiceLinkedContractBlockOwners> {
  const rows: Array<{ contract_line_id: string | null; issuance_id: string | null }> =
    await table(trx, tenant, 'hour_blocks')
      .where({ source_invoice_id: invoiceId })
      .whereNotNull('contract_line_id')
      .select('contract_line_id', 'issuance_id');
  const contractLineIds = [...new Set(rows.map((r) => r.contract_line_id!))].sort();
  const issuanceIds = [...new Set(rows.map((r) => r.issuance_id).filter((v): v is string => Boolean(v)))].sort();

  if (contractLineIds.length > 0) {
    await table(trx, tenant, 'contract_line_prepaid_blocks')
      .whereIn('contract_line_id', contractLineIds)
      .orderBy('contract_line_id', 'asc')
      .forUpdate()
      .select('contract_line_id');
  }
  if (issuanceIds.length > 0) {
    await table(trx, tenant, 'contract_line_block_issuances')
      .whereIn('issuance_id', issuanceIds)
      .orderBy('issuance_id', 'asc')
      .forUpdate()
      .select('issuance_id');
  }
  return { contractLineIds, issuanceIds };
}


export interface LockedInvoiceBlock {
  block_id: string;
  status: string;
  total_minutes: number | string;
  remaining_minutes: number | string;
  first_allocated_at: unknown;
  source_invoice_id: string | null;
  source_invoice_charge_id: string | null;
  service_id: string;
  client_id: string;
  client_contract_id: string | null;
  contract_line_id: string | null;
  issuance_id: string | null;
  /** Set for a cadence-mode block (one per service period); null for consumption blocks. */
  service_period_record_id: string | null;
}

/**
 * Locks, in ONE canonical block_id-ordered statement, every block linked to
 * the invoice plus all other blocks of the contract lines involved, so the
 * re-draw (`reconcileLineAllocations`, which locks a line's blocks canonically)
 * can never take a lower block_id after a higher one is already held.
 * Returns only the invoice-linked rows.
 */
export async function lockInvoiceBlocksWithLineSiblings(
  trx: Knex.Transaction,
  tenant: string,
  invoiceId: string,
  contractLineIds: string[],
): Promise<LockedInvoiceBlock[]> {
  const rows: LockedInvoiceBlock[] = await table(trx, tenant, 'hour_blocks')
    .where((qb: Knex.QueryBuilder) => {
      qb.where({ source_invoice_id: invoiceId });
      if (contractLineIds.length > 0) qb.orWhereIn('contract_line_id', contractLineIds);
    })
    .orderBy('block_id', 'asc')
    .forUpdate()
    .select(
      'block_id', 'status', 'total_minutes', 'remaining_minutes', 'first_allocated_at', 'source_invoice_id',
      'source_invoice_charge_id', 'service_id', 'client_id', 'client_contract_id', 'contract_line_id', 'issuance_id',
      'service_period_record_id',
    );
  return rows.filter((r) => r.source_invoice_id === invoiceId);
}

/**
 * Supersedes the line's SCHEDULED expiry issuance(s). Used when a newer block
 * is issued before the due date (an exhausted-and-replaced block must not
 * re-issue at its old expiry), when the source block goes back to pending or
 * is voided, and when the line's block config is removed.
 *
 * Caller must already hold the config (and issuance) lock for the line.
 * `onlySourceBlockId` restricts to the issuance triggered by that block;
 * `exceptSourceBlockId` keeps that block's own issuance.
 */
export async function supersedeExpiryIssuancesForLine(
  trx: Knex.Transaction,
  tenant: string,
  contractLineId: string,
  options: { reason: string; onlySourceBlockId?: string; exceptSourceBlockId?: string },
): Promise<number> {
  const query = table(trx, tenant, 'contract_line_block_issuances')
    .where({ contract_line_id: contractLineId, trigger_kind: 'expiry', status: 'scheduled' });
  if (options.onlySourceBlockId) query.where({ source_block_id: options.onlySourceBlockId });
  if (options.exceptSourceBlockId) {
    query.where((qb: Knex.QueryBuilder) => qb
      .whereNull('source_block_id')
      .orWhereNot('source_block_id', options.exceptSourceBlockId!));
  }
  return query.update({
    status: 'superseded',
    cancel_reason: options.reason,
    updated_at: new Date().toISOString(),
  });
}

/**
 * On activation of a contract block whose line has `trigger_on_expiry`,
 * schedules the `expiry` issuance due on the anniversary (invoice date +
 * expiry_months, plan D6) with `source_block_id` = the activated block.
 *
 * Any older scheduled expiry issuance for the line is superseded first (a
 * newer block now exists). The partial unique index allows exactly one
 * `scheduled` issuance per line, so if a non-expiry issuance is already open
 * (an exhaustion/threshold/manual/renewal obligation) the new expiry issuance
 * is skipped rather than violating the index; returns what happened.
 *
 * No expiry issuance is scheduled past the owning assignment's end_date (captain decision 2:
 * the contract ends, its blocks are forfeited and nothing new is issued): returns
 * `skipped_past_contract_end`. A due date equal to end_date is still allowed, matching the
 * issuance sync's cancellation ("due_date > end_date").
 */
export async function scheduleExpiryIssuanceForActivatedBlock(
  trx: Knex.Transaction,
  tenant: string,
  block: { block_id: string; client_id: string; contract_line_id: string; client_contract_id: string | null },
  invoiceDate: string | Date,
): Promise<'scheduled' | 'not_configured' | 'already_scheduled' | 'skipped_open_issuance' | 'skipped_past_contract_end'> {
  const config = await table(trx, tenant, 'contract_line_prepaid_blocks')
    .where({ contract_line_id: block.contract_line_id })
    .forUpdate()
    .first('expiry_months', 'trigger_on_expiry');

  // A newer block exists: the old block's expiry obligation is moot either way.
  await supersedeExpiryIssuancesForLine(trx, tenant, block.contract_line_id, {
    reason: 'A newer block was issued before the expiry date',
    exceptSourceBlockId: block.block_id,
  });

  if (!config || !config.trigger_on_expiry || config.expiry_months == null || !block.client_contract_id) {
    return 'not_configured';
  }

  const dueDate = computePrepaidBlockAnniversaryDate(invoiceDate, Number(config.expiry_months));
  const assignment = await table(trx, tenant, 'client_contracts')
    .where({ client_contract_id: block.client_contract_id })
    .first('end_date');
  const endDate = toDateOnly(assignment?.end_date);
  if (endDate && dueDate > endDate) return 'skipped_past_contract_end';

  const existingForBlock = await table(trx, tenant, 'contract_line_block_issuances')
    .where({ contract_line_id: block.contract_line_id, trigger_kind: 'expiry', source_block_id: block.block_id, status: 'scheduled' })
    .first('issuance_id');
  if (existingForBlock) return 'already_scheduled';

  const open = await table(trx, tenant, 'contract_line_block_issuances')
    .where({ contract_line_id: block.contract_line_id, status: 'scheduled' })
    .first('issuance_id');
  if (open) return 'skipped_open_issuance';

  await table(trx, tenant, 'contract_line_block_issuances').insert({
    tenant,
    issuance_id: uuidv4(),
    contract_line_id: block.contract_line_id,
    client_contract_id: block.client_contract_id,
    client_id: block.client_id,
    trigger_kind: 'expiry',
    due_date: dueDate,
    status: 'scheduled',
    source_block_id: block.block_id,
  });
  return 'scheduled';
}

/**
 * Manual "Issue next block" over a scheduled expiry issuance: supersedes it (same reason as a usage
 * follow-on) and returns its source block id, which the caller stores on the manual issuance so a
 * void of the manual block can restore it. Returns `null` when there is no scheduled expiry issuance.
 * Caller holds the config and issuance locks and must insert the manual issuance afterwards.
 */
export async function supersedeScheduledExpiryForManualIssue(
  trx: Knex.Transaction,
  tenant: string,
  contractLineId: string,
): Promise<{ superseded: boolean; sourceBlockId: string | null }> {
  const expiry = await table(trx, tenant, 'contract_line_block_issuances')
    .where({ contract_line_id: contractLineId, trigger_kind: 'expiry', status: 'scheduled' })
    .first('source_block_id');
  if (!expiry) return { superseded: false, sourceBlockId: null };
  await supersedeExpiryIssuancesForLine(trx, tenant, contractLineId, { reason: EXPIRY_REPLACED_BY_USAGE_BLOCK_REASON });
  return { superseded: true, sourceBlockId: expiry.source_block_id ?? null };
}

/**
 * Supersedes the line's scheduled expiry issuance because a `renewal` issuance is about to be
 * inserted (it carries the returned `sourceBlockId` so a void can restore the expiry). Caller holds
 * the config and issuance locks and inserts the renewal issuance afterwards.
 */
export async function supersedeScheduledExpiryForRenewal(
  trx: Knex.Transaction,
  tenant: string,
  contractLineId: string,
): Promise<{ superseded: boolean; sourceBlockId: string | null }> {
  const expiry = await table(trx, tenant, 'contract_line_block_issuances')
    .where({ contract_line_id: contractLineId, trigger_kind: 'expiry', status: 'scheduled' })
    .first('source_block_id');
  if (!expiry) return { superseded: false, sourceBlockId: null };
  await supersedeExpiryIssuancesForLine(trx, tenant, contractLineId, { reason: EXPIRY_REPLACED_BY_RENEWAL_BLOCK_REASON });
  return { superseded: true, sourceBlockId: expiry.source_block_id ?? null };
}

/** Undoes the supersession of a source block's expiry issuance by a usage-triggered follow-on or a renewal block. */
async function restoreSourceBlockExpiryIssuance(
  trx: Knex.Transaction,
  tenant: string,
  contractLineId: string,
  sourceBlockId: string | null,
): Promise<void> {
  if (!sourceBlockId) return;
  const sourceBlock = await table(trx, tenant, 'hour_blocks')
    .where({ block_id: sourceBlockId })
    .first('status');
  // An expired/voided source block no longer has an anniversary to forfeit at.
  if (!sourceBlock || sourceBlock.status !== 'active') return;
  const open = await table(trx, tenant, 'contract_line_block_issuances')
    .where({ contract_line_id: contractLineId, status: 'scheduled' })
    .first('issuance_id');
  if (open) return;
  await table(trx, tenant, 'contract_line_block_issuances')
    .where({
      contract_line_id: contractLineId,
      trigger_kind: 'expiry',
      status: 'superseded',
      source_block_id: sourceBlockId,
    })
    .whereIn('cancel_reason', [EXPIRY_REPLACED_BY_USAGE_BLOCK_REASON, EXPIRY_REPLACED_BY_RENEWAL_BLOCK_REASON])
    .update({ status: 'scheduled', cancel_reason: null, updated_at: new Date().toISOString() });
}

/**
 * Puts an issuance back into the right state after the block it produced was
 * voided (invoice deleted/voided):
 *  - contract_start / expiry / renewal: the date obligation still exists, so it
 *    returns to `scheduled` (re-due), unless the line's config is gone or
 *    another issuance is already scheduled for the line (then `superseded`/
 *    `cancelled` respectively, never violating the one-open-follow-on index);
 *  - exhaustion / threshold: usage-triggered, cancelled; the source block's expiry issuance that the
 *    follow-on superseded goes back to `scheduled` (the source block still expires on its anniversary).
 *    The prepaid alert
 *    keeps the episode suppressed (captain decision 4, unconfirmed) via
 *    suppressPrepaidReplenishmentForVoidedInvoice / clearPrepaidReplenishmentForInvoice;
 *  - manual: cancelled. A manual issuance is an on-demand MSP action, not an
 *    obligation; the MSP can issue another from the line card. If it superseded a scheduled expiry
 *    issuance (source_block_id set), that expiry issuance is restored like for an exhaustion follow-on.
 *
 * Caller holds the issuance/config locks.
 */
async function restoreIssuanceAfterBlockVoid(
  trx: Knex.Transaction,
  tenant: string,
  issuanceId: string,
  reason: string,
): Promise<void> {
  const issuance = await table(trx, tenant, 'contract_line_block_issuances')
    .where({ issuance_id: issuanceId })
    .first('issuance_id', 'status', 'trigger_kind', 'contract_line_id', 'source_block_id');
  if (!issuance || issuance.status !== 'invoiced') return;

  const now = new Date().toISOString();
  const cleared = { block_id: null, invoice_id: null, invoice_charge_id: null, updated_at: now };

  // A `renewal` issuance that replaced an expiry issuance (source_block_id set) is not re-due on
  // void: the line goes back to its expiry obligation, like after a voided usage follow-on.
  const replacedExpiry = issuance.trigger_kind === 'renewal' && Boolean(issuance.source_block_id);
  if (!REDUE_TRIGGER_KINDS.has(issuance.trigger_kind) || replacedExpiry) {
    await table(trx, tenant, 'contract_line_block_issuances')
      .where({ issuance_id: issuanceId })
      .update({ ...cleared, status: 'cancelled', cancel_reason: reason });
    // A manual issuance carries source_block_id only when it superseded a scheduled expiry issuance
    // (issueNextPrepaidBlock); voiding its block gives that expiry obligation back.
    if (['exhaustion', 'threshold', 'manual', 'renewal'].includes(issuance.trigger_kind)) {
      await restoreSourceBlockExpiryIssuance(trx, tenant, issuance.contract_line_id, issuance.source_block_id);
    }
    return;
  }

  const config = await table(trx, tenant, 'contract_line_prepaid_blocks')
    .where({ contract_line_id: issuance.contract_line_id })
    .first('contract_line_id');
  const otherOpen = await table(trx, tenant, 'contract_line_block_issuances')
    .where({ contract_line_id: issuance.contract_line_id, status: 'scheduled' })
    .whereNot({ issuance_id: issuanceId })
    .first('issuance_id');

  if (!config) {
    await table(trx, tenant, 'contract_line_block_issuances')
      .where({ issuance_id: issuanceId })
      .update({ ...cleared, status: 'cancelled', cancel_reason: `${reason}; block config removed` });
  } else if (otherOpen) {
    await table(trx, tenant, 'contract_line_block_issuances')
      .where({ issuance_id: issuanceId })
      .update({ ...cleared, status: 'superseded', cancel_reason: `${reason}; another issuance is already scheduled` });
  } else {
    await table(trx, tenant, 'contract_line_block_issuances')
      .where({ issuance_id: issuanceId })
      .update({
        ...cleared,
        status: 'scheduled',
        block_minutes: null,
        block_price: null,
        currency_code: null,
        cancel_reason: null,
      });
  }
}

/**
 * Releases a block's time allocations (audit `allocation_release`), restoring
 * the minutes to the block's balance. The released time entries are
 * uninvoiced, so they fall back to overage billing (or another block) when
 * `reconcileLineAllocations` re-draws the line. Caller holds the block lock.
 */
async function releaseBlockAllocations(
  trx: Knex.Transaction,
  tenant: string,
  blockId: string,
  userId: string | null,
  reason: string,
  now: string,
): Promise<number> {
  const allocations: Array<{ time_entry_id: string; minutes: number | string }> =
    await table(trx, tenant, 'hour_block_time_allocations')
      .where({ block_id: blockId })
      .select('time_entry_id', 'minutes');
  if (allocations.length === 0) return 0;

  const released = allocations.reduce((sum, a) => sum + Number(a.minutes), 0);
  await table(trx, tenant, 'hour_block_time_allocations').where({ block_id: blockId }).delete();
  await table(trx, tenant, 'hour_blocks')
    .where({ block_id: blockId })
    .update({ remaining_minutes: trx.raw('remaining_minutes + ?', [released]), updated_at: now });
  await table(trx, tenant, 'hour_block_audit').insert({
    tenant,
    block_id: blockId,
    type: 'allocation_release',
    minutes_delta: released,
    reason,
    created_by: userId,
    metadata: { time_entry_ids: [...new Set(allocations.map((a) => a.time_entry_id))] },
  });
  return released;
}

export interface VoidLinkedBlockInput {
  blockId: string;
  status: 'pending' | 'active' | 'expired';
  contractLineId: string | null;
  issuanceId: string | null;
  invoiceId: string;
  userId: string | null;
  now: string;
  reason: string;
  /** Sever hour_blocks.source_invoice_id (hard delete: the invoice row is about to disappear). */
  detachInvoice?: boolean;
}

/**
 * Releases allocations, voids the (locked) block, supersedes any expiry
 * issuance it triggered, and restores its issuance. Status-guarded: a block
 * that left `status` under the lock is skipped. Returns the contract line to
 * re-draw (via `reconcileLineAllocations`) when the block was a contract block.
 */
export async function releaseAndVoidLinkedBlock(
  trx: Knex.Transaction,
  tenant: string,
  input: VoidLinkedBlockInput,
): Promise<{ voided: boolean; contractLineId: string | null }> {
  const { blockId, status, now, userId } = input;

  await releaseBlockAllocations(trx, tenant, blockId, userId, input.reason, now);

  const voidedCount = await table(trx, tenant, 'hour_blocks')
    .where({ block_id: blockId, status })
    .update({
      status: 'voided',
      voided_at: now,
      voided_by: userId,
      void_reason: input.reason,
      updated_at: now,
      ...(input.detachInvoice ? { source_invoice_id: null } : {}),
    });
  if (voidedCount === 0) return { voided: false, contractLineId: null };

  await table(trx, tenant, 'hour_block_audit').insert({
    tenant,
    block_id: blockId,
    type: 'void',
    minutes_delta: null,
    reason: input.reason,
    created_by: userId,
    metadata: { source_invoice_id: input.invoiceId },
  });

  if (input.contractLineId) {
    await supersedeExpiryIssuancesForLine(trx, tenant, input.contractLineId, {
      reason: 'Source block was voided',
      onlySourceBlockId: blockId,
    });
  }
  if (input.issuanceId) {
    await restoreIssuanceAfterBlockVoid(trx, tenant, input.issuanceId, input.reason);
  }
  return { voided: true, contractLineId: input.contractLineId };
}

/** Re-draws each affected line (released minutes fall to overage or another block). Canonical line order. */
export async function redrawContractLines(
  trx: Knex.Transaction,
  tenant: string,
  contractLineIds: Iterable<string>,
): Promise<void> {
  for (const lineId of [...new Set(contractLineIds)].sort()) {
    await reconcileLineAllocations(trx, tenant, lineId);
  }
}

async function blockIsUsed(trx: Knex.Transaction, tenant: string, block: { block_id: string; first_allocated_at: unknown }): Promise<boolean> {
  if (block.first_allocated_at != null) return true;
  const row = await table(trx, tenant, 'hour_block_time_allocations')
    .where({ block_id: block.block_id })
    .count({ count: '*' })
    .first();
  return Number(row?.count ?? 0) > 0;
}

/**
 * Void-invoice hook (voidInvoiceActions): every hour block linked to the
 * invoice is released and voided.
 *  - `pending` blocks (deferred replenishment blocks that were never
 *    activated, and contract gap-draw blocks): allocations released, block
 *    voided, issuance restored per kind, line re-drawn. This closes the old gap
 *    where a voided bucket-replenishment invoice left its block pending forever.
 *  - `active` and `expired` blocks follow the existing manual-void guard: refused when the
 *    block has ever been used; an unused block is voided with the invoice.
 *  - already voided blocks are left as they are.
 *
 * Check-then-write: every refusal is decided under the locks before the first
 * write, so a refusal leaves nothing half-done (callers inside a transaction
 * that returns a failure result still commit nothing).
 */
export async function voidHourBlocksForVoidedInvoice(
  trx: Knex.Transaction,
  tenant: string,
  invoiceId: string,
  userId: string | null,
  now: string,
  voidReason: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { contractLineIds } = await lockPrepaidBlockOwnersForInvoice(trx, tenant, invoiceId);

  const linked = await lockInvoiceBlocksWithLineSiblings(trx, tenant, invoiceId, contractLineIds);

  for (const block of linked) {
    if ((block.status === 'active' || block.status === 'expired') && await blockIsUsed(trx, tenant, block)) {
      const usedHours = ((Number(block.total_minutes) - Number(block.remaining_minutes)) / 60).toFixed(1);
      const totalHours = (Number(block.total_minutes) / 60).toFixed(1);
      return {
        ok: false,
        error: `Cannot void this invoice: its hour block ${block.block_id} has already been used (${usedHours} of ${totalHours} hrs). Expire or adjust the hour block instead of voiding the invoice.`,
      };
    }
  }

  const reason = `Invoice voided: ${voidReason}`;
  const lines = new Set<string>(contractLineIds);
  for (const block of linked) {
    if (block.status !== 'pending' && block.status !== 'active' && block.status !== 'expired') continue;
    const result = await releaseAndVoidLinkedBlock(trx, tenant, {
      blockId: block.block_id,
      status: block.status,
      contractLineId: block.contract_line_id,
      issuanceId: block.issuance_id,
      invoiceId,
      userId,
      now,
      reason,
    });
    if (result.voided && result.contractLineId) lines.add(result.contractLineId);
  }
  await redrawContractLines(trx, tenant, lines);
  return { ok: true };
}
