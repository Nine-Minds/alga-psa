import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

/**
 * True when recorded time, or a stopwatch that is still open, points at the work item. Main's timer
 * table is `time_tracking_sessions` (status running|paused|logged|discarded); the reference's
 * `native_time_tracking_sessions` does not exist here. `includeFinished` also counts logged or
 * discarded sessions, whose receipts still name the source after the item is removed.
 * Rows are locked FOR SHARE so a concurrent start/log cannot slip in before the caller's delete.
 */
export async function hasNativeTimeReferences(trx: Knex.Transaction, tenant: string, workItemType: string, workItemId: string,
  options: { includeFinished?: boolean } = {}): Promise<boolean> {
  const owner = tenantDb(trx, tenant);
  if (await owner.table('time_entries').where({ work_item_type: workItemType, work_item_id: workItemId }).forShare().first('entry_id')) return true;
  const sessions = owner.table('time_tracking_sessions').where({ work_item_type: workItemType, work_item_id: workItemId });
  if (!options.includeFinished) sessions.whereIn('status', ['running', 'paused']);
  return !!await sessions.forShare().first('session_id');
}
