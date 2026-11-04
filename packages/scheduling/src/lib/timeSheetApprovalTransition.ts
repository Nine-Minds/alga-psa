import { v4 as uuidv4 } from 'uuid';
import { withTransaction, tenantDb } from '@alga-psa/db';
import type { Knex } from 'knex';

export type TimeSheetReversalFailure = 'not_found' | 'wrong_state' | 'invoiced' | 'forbidden';

export class TimeSheetReversalError extends Error {
  constructor(readonly reason: TimeSheetReversalFailure, message: string) {
    super(message);
    this.name = 'TimeSheetReversalError';
  }
}

/** Shared, atomic lifecycle transition used by REST and the server action. */
export async function reverseApprovedTimeSheet(input: {
  knex: Knex;
  tenant: string;
  timeSheetId: string;
  actorId: string;
  reason: string;
  authorize: (trx: Knex.Transaction, sheet: Record<string, any>) => Promise<void>;
}): Promise<void> {
  const { knex, tenant, timeSheetId, actorId, reason, authorize } = input;
  await withTransaction(knex, async (trx) => {
    const scopedDb = tenantDb(trx, tenant);
    // Keep the REST/invoice lock order: sheet first, then all entries in the sheet.
    const sheet = await scopedDb.table('time_sheets').where({ id: timeSheetId }).forUpdate().first();
    if (!sheet) throw new TimeSheetReversalError('not_found', 'Time sheet not found');

    const entries = scopedDb.table('time_entries').where({ time_sheet_id: timeSheetId });
    await entries.clone().forUpdate().select('entry_id');

    await authorize(trx, sheet);
    if (sheet.approval_status !== 'APPROVED') {
      throw new TimeSheetReversalError('wrong_state', 'Time sheet is not in an approved state');
    }

    const entryIds = entries.clone().select('entry_id');
    const hasInvoicedFlag = await entries.clone().where({ invoiced: true }).first('entry_id');
    const hasInvoiceLink = await scopedDb.table('invoice_time_entries')
      .where({ tenant }).whereIn('entry_id', entryIds).first('entry_id');
    if (hasInvoicedFlag || hasInvoiceLink) {
      throw new TimeSheetReversalError('invoiced', 'This time sheet contains invoiced time and cannot be reopened.');
    }

    const now = new Date();
    await scopedDb.table('time_sheets').where({ id: timeSheetId }).update({
      approval_status: 'CHANGES_REQUESTED',
      approved_at: null,
      approved_by: null,
      reversal_reason: reason,
      reversed_at: now,
      reversed_by: actorId,
    });
    await scopedDb.table('time_entries').where({ time_sheet_id: timeSheetId }).update({
      approval_status: 'CHANGES_REQUESTED',
      updated_at: now,
    });
    await scopedDb.table('time_sheet_comments').insert({
      comment_id: uuidv4(),
      time_sheet_id: timeSheetId,
      user_id: actorId,
      comment: `Approval reversed: ${reason}`,
      created_at: trx.fn.now(),
      is_approver: true,
      tenant,
    });
  });
}
