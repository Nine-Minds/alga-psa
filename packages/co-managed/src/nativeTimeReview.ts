import type { Knex } from 'knex';
import { tenantDb, withTransaction, registerAfterCommit } from '@alga-psa/db';
import { productTimeEntryMode } from '@alga-psa/types';
import { getCoManagedOperationalState, assertCoManagedOperationalWrite } from '@alga-psa/licensing';
import { hasCoManagedConversationOwnership } from './nativeConversationEvents';
import { lockCoManagedLocalAuthentication, snapshotCoManagedAuthenticatedActor, type CoManagedAuthenticatedActor } from './localAuthentication';
import { admitCoManagedNativeTimeSource, isNativeTimeFieldHidden } from './nativeTimeEntryAccess';
import { authorizeCoManagedLocalRecord, CoManagedSharedWorkError, isCoManagedUuid } from './sharedWorkIdentity';
import { hasCoManagedLocalPermission } from './localPermission';

export class NativeTimeReviewError extends Error {
  constructor(readonly code: 'TIME_REVIEW_NOT_FOUND' | 'TIME_REVIEW_STATE_CONFLICT' | 'TIME_REVIEW_BILLING_EVIDENCE') {
    super(code === 'TIME_REVIEW_NOT_FOUND' ? 'Time entry not found' : code === 'TIME_REVIEW_STATE_CONFLICT'
      ? 'Time entry cannot make the requested approval transition' : 'Invoiced time cannot change approval state');
    this.name = 'NativeTimeReviewError';
  }
}
export type NativeTimeReviewStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'CHANGES_REQUESTED';
export interface NativeTimeReviewEvent {
  eventType: 'TIME_ENTRY_APPROVED' | 'TIME_ENTRY_CHANGES_REQUESTED' | 'TIME_ENTRY_SUBMITTED' | 'TIME_ENTRY_UPDATED';
  payload: { tenantId: string; timeEntryId: string; userId: string; workItemId: string | null; workItemType: string;
    approvedBy?: string; requestedBy?: string; changes: { approvalStatus: NativeTimeReviewStatus } };
}

/** Native and REST review commands use actual home credentials and one retained
 * transaction. Private feedback stays in entry review history, never events. */
export async function reviewCoManagedNativeTimeEntry(db: Knex, tenant: string,
  input: { entryId: string; approvalStatus: NativeTimeReviewStatus; comment?: string },
  identify: () => Promise<CoManagedAuthenticatedActor>, publish: (event: NativeTimeReviewEvent) => Promise<void>): Promise<boolean> {
  const { entryId, approvalStatus } = input, comment = input.comment?.trim();
  if (!isCoManagedUuid(tenant) || !isCoManagedUuid(entryId) || !['DRAFT', 'SUBMITTED', 'APPROVED', 'CHANGES_REQUESTED'].includes(approvalStatus)) throw new CoManagedSharedWorkError();
  return withTransaction(db, async trx => {
    await getCoManagedOperationalState(trx, tenant);
    const owner = tenantDb(trx, tenant), workspace = await owner.table('tenants').forShare().first('product_code', 'suspended_at');
    const hint = await owner.table('time_entries').where('entry_id', entryId).first();
    if (workspace?.product_code !== 'co_managed' && hint?.billing_mode !== 'operational' && !await hasCoManagedConversationOwnership(trx, tenant)) return false;
    if (!workspace || workspace.suspended_at || !productTimeEntryMode(workspace.product_code)) throw new CoManagedSharedWorkError();
    await assertCoManagedOperationalWrite(trx, tenant);
    const actor = snapshotCoManagedAuthenticatedActor(await identify());
    if (actor.tenant !== tenant) throw new CoManagedSharedWorkError();
    // Match native writer order and serialize commands from the same actor.
    await owner.table('users').where('user_id', actor.userId).forUpdate().first('user_id');
    const credential = await lockCoManagedLocalAuthentication(trx, actor);
    if (!await hasCoManagedLocalPermission(trx, actor, 'time_sheet', 'approve', true) ||
        !await hasCoManagedLocalPermission(trx, actor, 'time_entry', 'approve', true)) throw new CoManagedSharedWorkError();
    if (!hint) throw new NativeTimeReviewError('TIME_REVIEW_NOT_FOUND');
    const access = await admitCoManagedNativeTimeSource(trx, actor, { ...hint, work_item_id: hint.work_item_id || '__non_billable__' }, 'review');
    const policy = await authorizeCoManagedLocalRecord(trx, actor, access.subject, 'time_entry', 'approve', access.record,
      approvalStatus === 'APPROVED' ? 'approve' : undefined);
    const fields = [...access.redactedTimeFields, ...policy.redactedFields];
    if (isNativeTimeFieldHidden(fields, ['entry_id', 'tenant', 'user_id', 'work_item_id', 'work_item_type', 'time_sheet_id', 'approval_status']) ||
        (comment && isNativeTimeFieldHidden(fields, ['notes', 'change_requests', 'latest_change_request', 'change_request_state']))) throw new CoManagedSharedWorkError();
    const sheet = hint.time_sheet_id ? await owner.table('time_sheets').where('id', hint.time_sheet_id).forUpdate().first() : null;
    if (!sheet) throw new NativeTimeReviewError('TIME_REVIEW_STATE_CONFLICT');
    const sheetPolicy = await authorizeCoManagedLocalRecord(trx, actor, access.subject, 'time_sheet', 'approve',
      { id: sheet.id, ownerUserId: sheet.user_id, assignedUserIds: [sheet.user_id] }, approvalStatus === 'APPROVED' ? 'approve' : undefined);
    if (isNativeTimeFieldHidden(sheetPolicy.redactedFields, ['id', 'approval_status', 'time_sheet_id', 'time_entries', 'entries'])) throw new CoManagedSharedWorkError();
    const entry = await owner.table('time_entries').where('entry_id', entryId).forUpdate().first();
    if (!entry || ['user_id', 'time_sheet_id', 'work_item_id', 'work_item_type', 'billing_mode'].some(field => entry[field] !== hint[field])) throw new CoManagedSharedWorkError();
    if (entry.invoiced || await owner.table('invoice_time_entries').where('entry_id', entryId).forShare().first()) throw new NativeTimeReviewError('TIME_REVIEW_BILLING_EVIDENCE');
    if (entry.approval_status === approvalStatus && !comment) { await access.assertCurrent(); await credential.assertCurrent(); return true; }
    const allowed: Record<string, readonly string[]> = {
      DRAFT: ['SUBMITTED'], SUBMITTED: ['DRAFT', 'APPROVED', 'CHANGES_REQUESTED'],
      CHANGES_REQUESTED: ['DRAFT', 'SUBMITTED', 'APPROVED'], APPROVED: ['DRAFT', 'CHANGES_REQUESTED'],
    };
    if (!allowed[entry.approval_status]?.includes(approvalStatus)) throw new NativeTimeReviewError('TIME_REVIEW_STATE_CONFLICT');
    const reopening = entry.approval_status === 'APPROVED' || sheet.approval_status === 'APPROVED';
    if (reopening) await authorizeCoManagedLocalRecord(trx, actor, access.subject, 'time_sheet', 'reverse', { id: sheet.id, ownerUserId: sheet.user_id, assignedUserIds: [sheet.user_id] });
    await owner.table('time_entries').where('entry_id', entryId).update({ approval_status: approvalStatus, updated_at: trx.fn.now(), updated_by: actor.userId });
    if (approvalStatus === 'CHANGES_REQUESTED' || reopening) {
      await owner.table('time_sheets').where('id', sheet.id).update({ approval_status: 'CHANGES_REQUESTED', approved_at: null, approved_by: null });
    }
    if (approvalStatus === 'CHANGES_REQUESTED' && comment) await owner.table('time_entry_change_requests').insert({
      tenant, change_request_id: trx.raw('gen_random_uuid()'), time_entry_id: entryId, time_sheet_id: sheet.id,
      comment, created_by: actor.userId, created_at: trx.fn.now(),
    });
    await access.assertCurrent(); await credential.assertCurrent();
    const eventType = approvalStatus === 'APPROVED' ? 'TIME_ENTRY_APPROVED' : approvalStatus === 'CHANGES_REQUESTED'
      ? 'TIME_ENTRY_CHANGES_REQUESTED' : approvalStatus === 'SUBMITTED' ? 'TIME_ENTRY_SUBMITTED' : 'TIME_ENTRY_UPDATED';
    registerAfterCommit(trx, () => publish({ eventType, payload: { tenantId: tenant, timeEntryId: entryId, userId: entry.user_id,
      workItemId: entry.work_item_id, workItemType: entry.work_item_type, approvedBy: approvalStatus === 'APPROVED' ? actor.userId : undefined,
      requestedBy: approvalStatus === 'CHANGES_REQUESTED' ? actor.userId : undefined, changes: { approvalStatus } } }), 'native-time-review');
    return true;
  });
}
