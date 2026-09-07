import type { Knex } from 'knex';
import { tenantDb, withTransaction, registerAfterCommit } from '@alga-psa/db';
import { productTimeEntryMode } from '@alga-psa/types';
import { getCoManagedOperationalState, assertCoManagedOperationalWrite } from '@alga-psa/licensing';
import { hasCoManagedConversationOwnership } from './nativeConversationEvents';
import { lockCoManagedLocalAuthentication, snapshotCoManagedAuthenticatedActor, type CoManagedAuthenticatedActor } from './localAuthentication';
import { admitCoManagedNativeTimeOwner, admitCoManagedNativeTimeSource, isNativeTimeFieldHidden, type CoManagedNativeTimeAccess } from './nativeTimeEntryAccess';
import { authorizeCoManagedLocalRecord, CoManagedSharedWorkError, isCoManagedUuid } from './sharedWorkIdentity';
import { hasCoManagedLocalPermission } from './localPermission';
import { NativeTimeReviewError, type NativeTimeReviewEvent, type NativeTimeReviewStatus } from './nativeTimeReview';

type SheetCommand = 'submit' | 'approve' | 'request_changes' | 'reverse';

/** Whole-sheet commands are all-or-nothing, including across bulk approval.
 * Every entry is admitted before any sheet state, entry or audit note changes.
 * A filtered sheet view must never confer authority over its hidden entries. */
export async function commandCoManagedNativeTimeSheets(db: Knex, tenant: string,
  input: { sheetIds: string[]; command: SheetCommand; reason?: string; actingUserId?: string },
  identify: () => Promise<CoManagedAuthenticatedActor>, publish: (event: NativeTimeReviewEvent) => Promise<void>
): Promise<{ handled: false } | { handled: true; sheets: any[] }> {
  const ids = [...new Set(input.sheetIds)].sort(), { command } = input, reason = input.reason?.trim();
  if (!isCoManagedUuid(tenant) || !ids.length || !ids.every(isCoManagedUuid) || !['submit', 'approve', 'request_changes', 'reverse'].includes(command)) throw new CoManagedSharedWorkError();
  return withTransaction(db, async trx => {
    await getCoManagedOperationalState(trx, tenant);
    const owner = tenantDb(trx, tenant), workspace = await owner.table('tenants').forShare().first('product_code', 'suspended_at');
    const operational = await owner.table('time_entries').whereIn('time_sheet_id', ids).where('billing_mode', 'operational').first('entry_id');
    if (workspace?.product_code !== 'co_managed' && !operational && !await hasCoManagedConversationOwnership(trx, tenant)) return { handled: false };
    if (!workspace || workspace.suspended_at || !productTimeEntryMode(workspace.product_code)) throw new CoManagedSharedWorkError();
    await assertCoManagedOperationalWrite(trx, tenant);
    const actor = snapshotCoManagedAuthenticatedActor(await identify());
    if (actor.tenant !== tenant || (input.actingUserId && input.actingUserId !== actor.userId)) throw new CoManagedSharedWorkError();
    await owner.table('users').where('user_id', actor.userId).forUpdate().first('user_id');
    const credential = await lockCoManagedLocalAuthentication(trx, actor);
    const action = command === 'submit' ? 'submit' : command === 'reverse' ? 'reverse' : 'approve';
    if (!await hasCoManagedLocalPermission(trx, actor, 'time_sheet', action, true)) throw new CoManagedSharedWorkError();
    const hints = await owner.table('time_sheets').whereIn('id', ids).orderBy('id').select('*');
    if (hints.length !== ids.length) throw new Error('Time sheet not found');
    // Retain all owners and sheets before acquiring any source parent locks.
    await owner.table('users').whereIn('user_id', [...new Set(hints.map(row => row.user_id))]).orderBy('user_id').forShare().select('user_id');
    for (const hint of hints) await admitCoManagedNativeTimeOwner(trx, actor, credential.subject, hint.user_id, command !== 'submit');
    const sheets = await owner.table('time_sheets').whereIn('id', ids).orderBy('id').forUpdate().select('*');
    const entries: Array<{ entry: any; access: CoManagedNativeTimeAccess }> = [];
    const policies = new Map<string, readonly string[]>();
    for (const sheet of sheets) {
      if (sheet.user_id !== hints.find(hint => hint.id === sheet.id)?.user_id) throw new CoManagedSharedWorkError();
      const record = { id: sheet.id, ownerUserId: sheet.user_id, assignedUserIds: [sheet.user_id] };
      const read = await authorizeCoManagedLocalRecord(trx, actor, credential.subject, 'time_sheet', 'read', record);
      const write = await authorizeCoManagedLocalRecord(trx, actor, credential.subject, 'time_sheet', action, record, command === 'approve' ? 'approve' : undefined);
      const fields = [...read.redactedFields, ...write.redactedFields];
      if (isNativeTimeFieldHidden(fields, ['id', 'tenant', 'user_id', 'period_id', 'approval_status', 'time_entries', 'entries']) ||
          (command === 'reverse' && isNativeTimeFieldHidden(fields, ['comments', 'time_sheet_comments', 'reason']))) throw new CoManagedSharedWorkError();
      policies.set(sheet.id, fields);
      if (!await owner.table('time_periods').where('period_id', sheet.period_id).forShare().first('period_id')) throw new NativeTimeReviewError('TIME_REVIEW_STATE_CONFLICT');
      const entryHints = await owner.table('time_entries').where('time_sheet_id', sheet.id).orderBy('entry_id').select('*');
      for (const hint of entryHints) {
        if (hint.user_id !== sheet.user_id) throw new CoManagedSharedWorkError();
        const access = await admitCoManagedNativeTimeSource(trx, actor, { ...hint, work_item_id: hint.work_item_id || '__non_billable__' }, command === 'submit' ? 'submit' : 'review');
        if (isNativeTimeFieldHidden(access.redactedTimeFields, ['entry_id', 'tenant', 'user_id', 'time_sheet_id', 'work_item_id', 'work_item_type', 'approval_status'])) throw new CoManagedSharedWorkError();
        if (command === 'approve') await authorizeCoManagedLocalRecord(trx, actor, access.subject, 'time_entry', 'approve', access.record, 'approve');
        const entry = await owner.table('time_entries').where('entry_id', hint.entry_id).forUpdate().first();
        if (!entry || ['user_id', 'time_sheet_id', 'work_item_id', 'work_item_type', 'billing_mode'].some(field => entry[field] !== hint[field])) throw new CoManagedSharedWorkError();
        entries.push({ entry, access });
      }
    }
    // Transition and billing checks follow full scope admission, so a bulk
    // error cannot reveal the state of a record outside the caller's scope.
    const allowed: Record<SheetCommand, readonly string[]> = { submit: ['DRAFT', 'CHANGES_REQUESTED'], approve: ['SUBMITTED'], request_changes: ['SUBMITTED'], reverse: ['APPROVED'] };
    if (sheets.some(sheet => !allowed[command].includes(sheet.approval_status)) || (command === 'reverse' && !reason)) throw new NativeTimeReviewError('TIME_REVIEW_STATE_CONFLICT');
    if (entries.some(({ entry }) => entry.invoiced) || await owner.table('invoice_time_entries').whereIn('entry_id', entries.map(({ entry }) => entry.entry_id)).forShare().first()) throw new NativeTimeReviewError('TIME_REVIEW_BILLING_EVIDENCE');
    if (command === 'approve' && entries.some(({ entry }) => !['SUBMITTED', 'CHANGES_REQUESTED', 'APPROVED'].includes(entry.approval_status))) throw new NativeTimeReviewError('TIME_REVIEW_STATE_CONFLICT');
    const status: NativeTimeReviewStatus = command === 'approve' ? 'APPROVED' : command === 'submit' ? 'SUBMITTED' : 'CHANGES_REQUESTED';
    const returned: any[] = [];
    for (const sheet of sheets) {
      const [updated] = await owner.table('time_sheets').where('id', sheet.id).update({ approval_status: status,
        ...(command === 'submit' ? { submitted_at: trx.fn.now() } : {}),
        approved_at: command === 'approve' ? trx.fn.now() : null, approved_by: command === 'approve' ? actor.userId : null,
      }).returning('*');
      if (command !== 'submit') await owner.table('time_sheet_comments').insert({ tenant, time_sheet_id: sheet.id, user_id: actor.userId,
        comment: command === 'approve' ? 'Time sheet approved' : command === 'reverse' ? `Approval reversed: ${reason}` : 'Changes requested for time sheet',
        created_at: trx.fn.now(), is_approver: true,
      });
      const fields = policies.get(sheet.id)!;
      // A command receipt does not disclose sheet-wide free text; detail reads
      // admit its complete content before projecting persistent notes.
      delete updated.notes;
      returned.push(Object.fromEntries(Object.entries(updated).map(([field, value]) => [field, isNativeTimeFieldHidden(fields, [field]) ? null : value])));
    }
    for (const { entry } of entries) {
      // Returning a partially reviewed sheet must preserve already approved
      // entries. Explicit reversal is the operation that reopens those too.
      if (entry.approval_status === status || (entry.approval_status === 'APPROVED' && command !== 'reverse')) continue;
      await owner.table('time_entries').where('entry_id', entry.entry_id).update({ approval_status: status, updated_at: trx.fn.now(), updated_by: actor.userId });
      const eventType = status === 'APPROVED' ? 'TIME_ENTRY_APPROVED' : status === 'SUBMITTED' ? 'TIME_ENTRY_SUBMITTED' : 'TIME_ENTRY_CHANGES_REQUESTED';
      registerAfterCommit(trx, () => publish({ eventType, payload: { tenantId: tenant, timeEntryId: entry.entry_id, userId: entry.user_id,
        workItemId: entry.work_item_id, workItemType: entry.work_item_type, approvedBy: status === 'APPROVED' ? actor.userId : undefined,
        requestedBy: status === 'CHANGES_REQUESTED' ? actor.userId : undefined, changes: { approvalStatus: status } } }), 'native-time-sheet-command');
    }
    for (const { access } of entries) await access.assertCurrent();
    await credential.assertCurrent(); await assertCoManagedOperationalWrite(trx, tenant);
    return { handled: true, sheets: returned };
  });
}
