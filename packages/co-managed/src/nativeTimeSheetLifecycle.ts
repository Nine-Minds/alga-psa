import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { productTimeEntryMode } from '@alga-psa/types';
import { getCoManagedOperationalState, assertCoManagedOperationalWrite } from '@alga-psa/licensing';
import { hasCoManagedConversationOwnership } from './nativeConversationEvents';
import { lockCoManagedLocalAuthentication, snapshotCoManagedAuthenticatedActor, type CoManagedAuthenticatedActor } from './localAuthentication';
import { authorizeCoManagedLocalRecord, CoManagedSharedWorkError, isCoManagedUuid } from './sharedWorkIdentity';
import { admitCoManagedNativeTimeOwner, admitCoManagedNativeTimeSource, isNativeTimeFieldHidden } from './nativeTimeEntryAccess';
import { readCoManagedNativeTimeSheet } from './nativeTimeRead';
import { commandCoManagedNativeTimeSheets } from './nativeTimeSheetCommand';
import type { NativeTimeReviewEvent } from './nativeTimeReview';

export class NativeTimeSheetError extends Error {
  constructor(readonly code: 'SHEET_ALREADY_EXISTS' | 'SHEET_NOT_EDITABLE' | 'SHEET_INVALID_TRANSITION' | 'SHEET_INVALID_INPUT') {
    super({ SHEET_ALREADY_EXISTS: 'A time sheet already exists for this user and period', SHEET_NOT_EDITABLE: 'Only draft or returned sheets can have their notes edited', SHEET_INVALID_TRANSITION: 'Use the appropriate time sheet review command for this transition', SHEET_INVALID_INPUT: 'Invalid time sheet input' }[code]);
    this.name = 'NativeTimeSheetError';
  }
}

async function customerTimeWorkspace(trx: Knex.Transaction, tenant: string) {
  await getCoManagedOperationalState(trx, tenant);
  const owner = tenantDb(trx, tenant), workspace = await owner.table('tenants').forShare().first('product_code', 'suspended_at');
  const operational = await owner.table('time_entries').where(q => q.where('billing_mode', 'operational').orWhere('work_item_type', 'co_managed')).first('entry_id');
  if (workspace?.product_code !== 'co_managed' && !operational && !await hasCoManagedConversationOwnership(trx, tenant)) return false;
  if (!workspace || workspace.suspended_at || !productTimeEntryMode(workspace.product_code)) throw new CoManagedSharedWorkError();
  return true;
}

/** Opening existing history is a read. Only the missing-sheet branch consumes
 * write authority. The target-user lock also serializes automatic API time
 * sheet creation, which retains that same user before checking its period. */
export function openCoManagedNativeTimeSheet(db: Knex, tenant: string, input: { userId: string; periodId: string },
  identify: () => Promise<CoManagedAuthenticatedActor>) {
  return openTimeSheet(db, tenant, input, identify, 'open');
}

/** Explicit API creation conflicts on an existing sheet; lazy browser/API entry
 * opening remains idempotent. Both serialize on the same actual target user. */
export function createCoManagedNativeTimeSheet(db: Knex, tenant: string, input: { userId: string; periodId: string; notes?: string },
  identify: () => Promise<CoManagedAuthenticatedActor>) {
  return openTimeSheet(db, tenant, input, identify, 'create');
}

async function openTimeSheet(db: Knex, tenant: string, input: { userId: string; periodId: string; notes?: string },
  identify: () => Promise<CoManagedAuthenticatedActor>, mode: 'open' | 'create'
): Promise<{ handled: false } | { handled: true; sheet: any; created: boolean }> {
  const { userId, periodId } = input;
  if (![tenant, userId, periodId].every(isCoManagedUuid)) throw new CoManagedSharedWorkError();
  return withTransaction(db, async trx => {
    if (!await customerTimeWorkspace(trx, tenant)) return { handled: false };
    if (input.notes !== undefined && typeof input.notes !== 'string') throw new NativeTimeSheetError('SHEET_INVALID_INPUT');
    const actor = snapshotCoManagedAuthenticatedActor(await identify()), owner = tenantDb(trx, tenant);
    if (actor.tenant !== tenant) throw new CoManagedSharedWorkError();
    await owner.table('users').whereIn('user_id', [...new Set([actor.userId, userId])]).orderBy('user_id').forUpdate().select('user_id');
    const credential = await lockCoManagedLocalAuthentication(trx, actor);
    await admitCoManagedNativeTimeOwner(trx, actor, credential.subject, userId, true);
    const existing = await owner.table('time_sheets').where({ user_id: userId, period_id: periodId }).orderBy('id').select('id');
    if (existing.length > 1) throw new Error('Multiple time sheets exist for this user and period; reconcile them before continuing');
    let id = existing[0]?.id;
    if (!id) {
      await assertCoManagedOperationalWrite(trx, tenant);
      await admitCoManagedNativeTimeOwner(trx, actor, credential.subject, userId, false);
      const record = { ownerUserId: userId, assignedUserIds: [userId] };
      const read = await authorizeCoManagedLocalRecord(trx, actor, credential.subject, 'time_sheet', 'read', record);
      const create = await authorizeCoManagedLocalRecord(trx, actor, credential.subject, 'time_sheet', 'create', record);
      if (isNativeTimeFieldHidden([...read.redactedFields, ...create.redactedFields], ['id', 'tenant', 'user_id', 'period_id', 'approval_status', 'time_entries', 'entries'])) throw new CoManagedSharedWorkError();
      if (input.notes !== undefined && isNativeTimeFieldHidden([...read.redactedFields, ...create.redactedFields], ['notes', 'time_sheets.notes'])) throw new CoManagedSharedWorkError();
      // Native sheet writers retain the sheet before its period. This branch
      // has no existing sheet to lock, and retains the period against deletion.
      if (!await owner.table('time_periods').where('period_id', periodId).forShare().first('period_id')) throw new Error('Time period not found');
      const [created] = await owner.table('time_sheets').insert({ tenant, user_id: userId, period_id: periodId, approval_status: 'DRAFT', ...(input.notes !== undefined ? { notes: input.notes } : {}) }).returning('id');
      id = created.id;
    }
    const current = await readCoManagedNativeTimeSheet(trx, tenant, id, async () => actor, { view: true, comments: true });
    if (!current.handled || current.sheet?.user_id !== userId || current.sheet?.period_id !== periodId) throw new CoManagedSharedWorkError();
    await credential.assertCurrent();
    if (existing.length && mode === 'create') throw new NativeTimeSheetError('SHEET_ALREADY_EXISTS');
    if (!existing.length) await assertCoManagedOperationalWrite(trx, tenant);
    return { handled: true, sheet: { ...current.sheet, comments: current.comments }, created: !existing.length };
  });
}

/** Empty draft removal retains the actual sheet against both commands and FK
 * inserts. Private child feedback is removed only with a successful deletion. */
export async function deleteCoManagedNativeTimeSheet(db: Knex, tenant: string, sheetId: string,
  identify: () => Promise<CoManagedAuthenticatedActor>): Promise<boolean> {
  if (![tenant, sheetId].every(isCoManagedUuid)) throw new CoManagedSharedWorkError();
  return withTransaction(db, async trx => {
    if (!await customerTimeWorkspace(trx, tenant)) return false;
    await assertCoManagedOperationalWrite(trx, tenant);
    const actor = snapshotCoManagedAuthenticatedActor(await identify()), owner = tenantDb(trx, tenant);
    if (actor.tenant !== tenant) throw new CoManagedSharedWorkError();
    const hint = await owner.table('time_sheets').where('id', sheetId).first('user_id');
    await owner.table('users').whereIn('user_id', [...new Set([actor.userId, ...(hint ? [hint.user_id] : [])])]).orderBy('user_id').forUpdate().select('user_id');
    const credential = await lockCoManagedLocalAuthentication(trx, actor);
    // Evaluate even a missing target under current delete authority before
    // returning a not-found result.
    const record = { id: sheetId, ownerUserId: hint?.user_id, assignedUserIds: hint ? [hint.user_id] : [] };
    if (hint) await admitCoManagedNativeTimeOwner(trx, actor, credential.subject, hint.user_id, true);
    const policy = await authorizeCoManagedLocalRecord(trx, actor, credential.subject, 'time_sheet', 'delete', record);
    if (!hint) throw new Error('Time sheet not found');
    const read = await authorizeCoManagedLocalRecord(trx, actor, credential.subject, 'time_sheet', 'read', record);
    if (isNativeTimeFieldHidden([...policy.redactedFields, ...read.redactedFields], ['id', 'tenant', 'user_id', 'period_id', 'approval_status'])) throw new CoManagedSharedWorkError();
    const sheet = await owner.table('time_sheets').where('id', sheetId).forUpdate().first();
    if (!sheet || sheet.user_id !== hint.user_id) throw new CoManagedSharedWorkError();
    if (!['DRAFT', 'CHANGES_REQUESTED'].includes(sheet.approval_status)) throw new Error('Only draft time sheets can be removed');
    const entry = await owner.table('time_entries').where('time_sheet_id', sheetId).orderBy('entry_id').first();
    if (entry) {
      // A nonempty conflict must not reveal an entry outside current work scope.
      await admitCoManagedNativeTimeSource(trx, actor, { ...entry, work_item_id: entry.work_item_id || '__non_billable__' }, 'read');
      throw new Error('Time sheet still has time entries');
    }
    await owner.table('time_entry_change_requests').where('time_sheet_id', sheetId).del();
    await owner.table('time_sheet_comments').where('time_sheet_id', sheetId).del();
    await owner.table('time_sheets').where('id', sheetId).del();
    await credential.assertCurrent(); await assertCoManagedOperationalWrite(trx, tenant);
    return true;
  });
}

/** Generic sheet edits still require the domain command for every status
 * transition. Free text requires complete sheet content visibility and remains
 * editable only before submission or after a return for changes. */
export async function editCoManagedNativeTimeSheet(db: Knex, tenant: string, sheetId: string,
  input: { notes?: string; approval_status?: string }, identify: () => Promise<CoManagedAuthenticatedActor>,
  publish: (event: NativeTimeReviewEvent) => Promise<void>
): Promise<boolean> {
  if (![tenant, sheetId].every(isCoManagedUuid)) throw new CoManagedSharedWorkError();
  return withTransaction(db, async trx => {
    if (!await customerTimeWorkspace(trx, tenant)) return false;
    if ((input.notes !== undefined && typeof input.notes !== 'string') ||
        (input.approval_status !== undefined && !['DRAFT', 'SUBMITTED', 'APPROVED', 'CHANGES_REQUESTED'].includes(input.approval_status))) throw new NativeTimeSheetError('SHEET_INVALID_INPUT');
    await assertCoManagedOperationalWrite(trx, tenant);
    const actor = snapshotCoManagedAuthenticatedActor(await identify()), owner = tenantDb(trx, tenant);
    if (actor.tenant !== tenant) throw new CoManagedSharedWorkError();
    const hint = await owner.table('time_sheets').where('id', sheetId).first('user_id');
    await owner.table('users').whereIn('user_id', [...new Set([actor.userId, ...(hint ? [hint.user_id] : [])])]).orderBy('user_id').forUpdate().select('user_id');
    const credential = await lockCoManagedLocalAuthentication(trx, actor);
    if (!hint) throw new CoManagedSharedWorkError();
    await admitCoManagedNativeTimeOwner(trx, actor, credential.subject, hint.user_id, true);
    const record = { id: sheetId, ownerUserId: hint.user_id, assignedUserIds: [hint.user_id] };
    const read = await authorizeCoManagedLocalRecord(trx, actor, credential.subject, 'time_sheet', 'read', record);
    const write = await authorizeCoManagedLocalRecord(trx, actor, credential.subject, 'time_sheet', 'update', record);
    const fields = [...read.redactedFields, ...write.redactedFields];
    if (isNativeTimeFieldHidden(fields, ['id', 'tenant', 'user_id', 'period_id', 'approval_status', 'time_entries', 'entries']) ||
        (input.notes !== undefined && isNativeTimeFieldHidden(fields, ['notes', 'time_sheets.notes']))) throw new CoManagedSharedWorkError();
    const sheet = await owner.table('time_sheets').where('id', sheetId).forUpdate().first();
    if (!sheet || sheet.user_id !== hint.user_id) throw new CoManagedSharedWorkError();
    const current = await readCoManagedNativeTimeSheet(trx, tenant, sheetId, async () => actor, { view: true, requireCompleteContent: input.notes !== undefined });
    if (!current.handled) throw new CoManagedSharedWorkError();
    if (input.notes !== undefined) {
      if (!['DRAFT', 'CHANGES_REQUESTED'].includes(sheet.approval_status)) throw new NativeTimeSheetError('SHEET_NOT_EDITABLE');
      await owner.table('time_sheets').where('id', sheetId).update({ notes: input.notes });
    }
    if (input.approval_status !== undefined && input.approval_status !== sheet.approval_status) {
      const command = input.approval_status === 'SUBMITTED' ? 'submit' : input.approval_status === 'APPROVED' ? 'approve' :
        input.approval_status === 'CHANGES_REQUESTED' && sheet.approval_status === 'SUBMITTED' ? 'request_changes' : undefined;
      if (!command) throw new NativeTimeSheetError('SHEET_INVALID_TRANSITION');
      const result = await commandCoManagedNativeTimeSheets(trx, tenant, { sheetIds: [sheetId], command }, async () => actor, publish);
      if (!result.handled) throw new CoManagedSharedWorkError();
    }
    await credential.assertCurrent(); await assertCoManagedOperationalWrite(trx, tenant);
    return true;
  });
}
