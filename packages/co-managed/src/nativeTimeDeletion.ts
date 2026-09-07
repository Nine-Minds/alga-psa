import type { Knex } from 'knex';
import { tenantDb, withTransaction, registerAfterCommit, recalculateProjectTaskActualHoursForEntryChange } from '@alga-psa/db';
import { getCoManagedOperationalState, assertCoManagedOperationalWrite } from '@alga-psa/licensing';
import { productTimeEntryMode } from '@alga-psa/types';
import { hasCoManagedConversationOwnership } from './nativeConversationEvents';
import { lockCoManagedLocalAuthentication, snapshotCoManagedAuthenticatedActor, type CoManagedAuthenticatedActor } from './localAuthentication';
import { admitCoManagedNativeTimeSource, isNativeTimeFieldHidden } from './nativeTimeEntryAccess';
import { hasCoManagedLocalPermission } from './localPermission';
import { CoManagedSharedWorkError, isCoManagedUuid } from './sharedWorkIdentity';

export class NativeTimeDeletionError extends Error {
  constructor(readonly code: 'TIME_DELETE_NOT_FOUND' | 'TIME_DELETE_NOT_EDITABLE' | 'TIME_DELETE_BILLING_EVIDENCE') {
    super(code === 'TIME_DELETE_NOT_FOUND' ? 'Time entry not found' : code === 'TIME_DELETE_NOT_EDITABLE' ? 'Only uninvoiced entries on editable time sheets can be deleted' : 'Time entry has retained billing evidence and cannot be deleted');
    this.name = 'NativeTimeDeletionError';
  }
}
export interface NativeTimeDeletionEvent { tenantId: string; timeEntryId: string; userId: string; deletedBy: string; workItemId: string | null; workItemType: string }

/** Authorization and deletion share one transaction. Billing adapters operate
 * on the retained original row; notification adapters receive identities only. */
export async function deleteCoManagedNativeTimeEntry(db: Knex, tenant: string, entryId: string,
  identify: () => Promise<CoManagedAuthenticatedActor>, reverseBilling: (trx: Knex.Transaction, entry: any) => Promise<void>,
  publish: (event: NativeTimeDeletionEvent) => Promise<void>): Promise<boolean> {
  if (!isCoManagedUuid(tenant) || !isCoManagedUuid(entryId)) throw new CoManagedSharedWorkError();
  return withTransaction(db, async trx => {
    await getCoManagedOperationalState(trx, tenant);
    const owner = tenantDb(trx, tenant), workspace = await owner.table('tenants').forShare().first('product_code', 'suspended_at');
    const hint = await owner.table('time_entries').where('entry_id', entryId).first();
    if (workspace?.product_code !== 'co_managed' && hint?.billing_mode !== 'operational' && !await hasCoManagedConversationOwnership(trx, tenant)) return false;
    if (!workspace || workspace.suspended_at || !productTimeEntryMode(workspace.product_code)) throw new CoManagedSharedWorkError();
    await assertCoManagedOperationalWrite(trx, tenant);
    const actor = snapshotCoManagedAuthenticatedActor(await identify());
    if (actor.tenant !== tenant) throw new CoManagedSharedWorkError();
    await owner.table('users').where('user_id', actor.userId).forUpdate().first('user_id');
    const credential = await lockCoManagedLocalAuthentication(trx, actor);
    if (!await hasCoManagedLocalPermission(trx, actor, 'time_entry', 'delete', true)) throw new CoManagedSharedWorkError();
    if (!hint) throw new NativeTimeDeletionError('TIME_DELETE_NOT_FOUND');
    const access = await admitCoManagedNativeTimeSource(trx, actor, { ...hint, work_item_id: hint.work_item_id || '__non_billable__' }, 'delete');
    if (isNativeTimeFieldHidden(access.redactedTimeFields, ['entry_id', 'tenant', 'user_id', 'work_item_id', 'work_item_type'])) throw new CoManagedSharedWorkError();
    const entry = await owner.table('time_entries').where('entry_id', entryId).forUpdate().first();
    if (!entry || ['user_id', 'time_sheet_id', 'work_item_id', 'work_item_type', 'billing_mode'].some(field => entry[field] !== hint[field])) throw new CoManagedSharedWorkError();
    // State conflicts are reported only after actual read/delete scope passes.
    const sheet = entry.time_sheet_id ? await owner.table('time_sheets').where('id', entry.time_sheet_id).forUpdate().first('approval_status') : null;
    if ((entry.time_sheet_id && (!sheet || !['DRAFT', 'CHANGES_REQUESTED'].includes(sheet.approval_status))) || entry.invoiced || !['DRAFT', 'CHANGES_REQUESTED'].includes(entry.approval_status)) throw new NativeTimeDeletionError('TIME_DELETE_NOT_EDITABLE');
    if (await owner.table('invoice_time_entries').where('entry_id', entryId).forShare().first()) throw new NativeTimeDeletionError('TIME_DELETE_BILLING_EVIDENCE');
    await reverseBilling(trx, entry);
    await owner.table('time_entry_change_requests').where('time_entry_id', entryId).del();
    await owner.table('time_entries').where('entry_id', entryId).del();
    await recalculateProjectTaskActualHoursForEntryChange(trx, tenant, entry, null);
    await access.assertCurrent(); await credential.assertCurrent();
    registerAfterCommit(trx, () => publish({ tenantId: tenant, timeEntryId: entryId, userId: entry.user_id, deletedBy: actor.userId,
      workItemId: entry.work_item_id, workItemType: entry.work_item_type }), 'native-time-delete');
    return true;
  });
}
