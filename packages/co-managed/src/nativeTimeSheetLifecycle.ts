import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { productTimeEntryMode } from '@alga-psa/types';
import { getCoManagedOperationalState, assertCoManagedOperationalWrite } from '@alga-psa/licensing';
import { hasCoManagedConversationOwnership } from './nativeConversationEvents';
import { lockCoManagedLocalAuthentication, snapshotCoManagedAuthenticatedActor, type CoManagedAuthenticatedActor } from './localAuthentication';
import { authorizeCoManagedLocalRecord, CoManagedSharedWorkError, isCoManagedUuid } from './sharedWorkIdentity';
import { admitCoManagedNativeTimeOwner, admitCoManagedNativeTimeSource, isNativeTimeFieldHidden } from './nativeTimeEntryAccess';
import { readCoManagedNativeTimeSheet } from './nativeTimeRead';

async function customerTimeWorkspace(trx: Knex.Transaction, tenant: string) {
  await getCoManagedOperationalState(trx, tenant);
  const owner = tenantDb(trx, tenant), workspace = await owner.table('tenants').forShare().first('product_code', 'suspended_at');
  const operational = await owner.table('time_entries').where('billing_mode', 'operational').first('entry_id');
  if (workspace?.product_code !== 'co_managed' && !operational && !await hasCoManagedConversationOwnership(trx, tenant)) return false;
  if (!workspace || workspace.suspended_at || !productTimeEntryMode(workspace.product_code)) throw new CoManagedSharedWorkError();
  return true;
}

/** Opening existing history is a read. Only the missing-sheet branch consumes
 * write authority. The target-user lock also serializes automatic API time
 * sheet creation, which retains that same user before checking its period. */
export async function openCoManagedNativeTimeSheet(db: Knex, tenant: string, input: { userId: string; periodId: string },
  identify: () => Promise<CoManagedAuthenticatedActor>): Promise<{ handled: false } | { handled: true; sheet: any; created: boolean }> {
  const { userId, periodId } = input;
  if (![tenant, userId, periodId].every(isCoManagedUuid)) throw new CoManagedSharedWorkError();
  return withTransaction(db, async trx => {
    if (!await customerTimeWorkspace(trx, tenant)) return { handled: false };
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
      // Native sheet writers retain the sheet before its period. This branch
      // has no existing sheet to lock, and retains the period against deletion.
      if (!await owner.table('time_periods').where('period_id', periodId).forShare().first('period_id')) throw new Error('Time period not found');
      const [created] = await owner.table('time_sheets').insert({ tenant, user_id: userId, period_id: periodId, approval_status: 'DRAFT' }).returning('id');
      id = created.id;
    }
    const current = await readCoManagedNativeTimeSheet(trx, tenant, id, async () => actor, { view: true, comments: true });
    if (!current.handled || current.sheet?.user_id !== userId || current.sheet?.period_id !== periodId) throw new CoManagedSharedWorkError();
    await credential.assertCurrent();
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
