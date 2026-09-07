import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { NativeTimeDeletionError } from '@alga-psa/co-managed';
import { adjustTimeSpanDraw } from '@alga-psa/shared/billingClients/drawAdjustments';
import { reverseTimeEntryAllocations } from '@alga-psa/shared/billingClients/hourBlockService';
import { getClientIdForWorkItem } from '../actions/timeEntryHelpers';

/** Called only with a retained, authorized entry inside its deleting transaction.
 * A failed reversal must preserve the original entry and every allocation. */
export async function reverseDeletedTimeEntryBilling(trx: Knex.Transaction, tenant: string, entry: any): Promise<void> {
  if (!trx.isTransaction) throw new Error('Time deletion billing requires its owning transaction');
  if (entry.billing_mode === 'operational') {
    if (await tenantDb(trx, tenant).table('hour_block_time_allocations').where('time_entry_id', entry.entry_id).forShare().first()) throw new NativeTimeDeletionError('TIME_DELETE_BILLING_EVIDENCE');
    return;
  }
  if (entry.service_id && Number(entry.billable_duration) > 0) {
    const clientId = entry.work_item_id ? await getClientIdForWorkItem(trx, tenant, entry.work_item_id, entry.work_item_type) : null;
    if (clientId) await adjustTimeSpanDraw(trx, tenant, clientId, {
      service_id: entry.service_id, start_time: entry.start_time, end_time: entry.end_time,
      billable_duration: entry.billable_duration, contract_line_id: entry.contract_line_id ?? null,
    }, -1);
  }
  // LEVERAGE: friction time-allocation-command-locks — deletion retains the entry; nightly reconciliation must share that serialization before reading reversal allocations.
  await reverseTimeEntryAllocations(trx, tenant, entry.entry_id);
}
