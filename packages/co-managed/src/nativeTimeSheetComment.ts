import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { assertCoManagedOperationalWrite } from '@alga-psa/licensing';
import { lockCoManagedLocalAuthentication, snapshotCoManagedAuthenticatedActor, type CoManagedAuthenticatedActor } from './localAuthentication';
import { authorizeCoManagedLocalRecord, CoManagedSharedWorkError } from './sharedWorkIdentity';
import { isNativeTimeFieldHidden, admitCoManagedNativeTimeOwner } from './nativeTimeEntryAccess';
import { readCoManagedNativeTimeSheet } from './nativeTimeRead';

/** A sheet-wide comment requires full content visibility of the sheet. The
 * author and reviewer attribution are derived from current home authority. */
export async function addCoManagedNativeTimeSheetComment(db: Knex, tenant: string,
  input: { sheetId: string; userId: string; comment: string }, identify: () => Promise<CoManagedAuthenticatedActor>
): Promise<{ handled: false } | { handled: true; comment: any }> {
  const { sheetId, userId } = input, text = input.comment?.trim();
  return withTransaction(db, async trx => {
    let actor: CoManagedAuthenticatedActor | undefined;
    const current = await readCoManagedNativeTimeSheet(trx, tenant, sheetId, async () => {
      actor = snapshotCoManagedAuthenticatedActor(await identify());
      if (actor.tenant !== tenant || actor.userId !== userId) throw new CoManagedSharedWorkError();
      await tenantDb(trx, tenant).table('users').where('user_id', actor.userId).forUpdate().first('user_id');
      return actor;
    }, { view: true, requireCompleteContent: true });
    if (!current.handled) return current;
    if (!actor || !current.sheet) throw new CoManagedSharedWorkError();
    if (!text) throw new Error('Comment cannot be empty');
    await assertCoManagedOperationalWrite(trx, tenant);
    const owner = tenantDb(trx, tenant), credential = await lockCoManagedLocalAuthentication(trx, actor);
    await admitCoManagedNativeTimeOwner(trx, actor, credential.subject, current.sheet.user_id, true);
    const record = { id: sheetId, ownerUserId: current.sheet.user_id, assignedUserIds: [current.sheet.user_id] };
    const isApprover = actor.userId !== current.sheet.user_id;
    const read = await authorizeCoManagedLocalRecord(trx, actor, credential.subject, 'time_sheet', 'read', record);
    const write = await authorizeCoManagedLocalRecord(trx, actor, credential.subject, 'time_sheet', isApprover ? 'approve' : 'submit', record);
    if (isNativeTimeFieldHidden([...read.redactedFields, ...write.redactedFields], ['comments', 'comment', 'time_sheet_comments',
      'comments.comment', 'comments.user_id', 'comments.comment_id', 'comments.created_at', 'comments.is_approver',
      'time_sheet_comments.comment', 'time_sheet_comments.user_id', 'time_sheet_comments.comment_id', 'time_sheet_comments.created_at', 'time_sheet_comments.is_approver'])) throw new CoManagedSharedWorkError();
    const [row] = await owner.table('time_sheet_comments').insert({ tenant, time_sheet_id: sheetId, user_id: actor.userId,
      comment: text, is_approver: isApprover, created_at: trx.fn.now() }).returning('*');
    await credential.assertCurrent(); await assertCoManagedOperationalWrite(trx, tenant);
    return { handled: true, comment: { tenant, comment_id: row.comment_id, time_sheet_id: sheetId, user_id: actor.userId,
      comment: text, is_approver: isApprover, created_at: new Date(row.created_at).toISOString() } };
  });
}
