/** Guarded time-sheet approval transitions shared by REST status writers. */
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb, withViaPrincipal, type ServiceContext } from '@alga-psa/db';
import { assertHumanWorkOwner } from '@alga-psa/shared/lib/humanWork/assertHumanWorkAssignee';
import { hasApiContextPermission } from '../middleware/apiContextPermission';
import { ConflictError, ForbiddenError, NotFoundError } from '../middleware/apiMiddleware';

type Status = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'CHANGES_REQUESTED';
type Target = Exclude<Status, 'DRAFT'>;

const transitions: Record<Target, { from: Status[]; permission: 'update' | 'approve'; message: string }> = {
  SUBMITTED: { from: ['DRAFT', 'CHANGES_REQUESTED'], permission: 'update', message: 'Time sheet can only be submitted from DRAFT or CHANGES_REQUESTED status' },
  APPROVED: { from: ['SUBMITTED'], permission: 'approve', message: 'Time sheet must be submitted before approval' },
  CHANGES_REQUESTED: { from: ['SUBMITTED'], permission: 'approve', message: 'Time sheet must be submitted before requesting changes' },
};

export function assertTransitionTarget(target: string): asserts target is Target {
  if (!Object.prototype.hasOwnProperty.call(transitions, target)) {
    throw new ConflictError(`Time sheet status cannot be set to ${target} directly`);
  }
}

export async function transitionTimeSheet(
  trx: Knex.Transaction,
  sheetId: string,
  target: string,
  context: ServiceContext,
  payload: { submission_notes?: string; approval_notes?: string; change_reason?: string; detailed_feedback?: string } = {},
): Promise<void> {
  assertTransitionTarget(target);
  const db = tenantDb(trx, context.tenant);
  const sheet = await db.table('time_sheets').where({ id: sheetId }).forUpdate().first('id', 'user_id', 'approval_status');
  if (!sheet) throw new NotFoundError('Time sheet not found');

  const ownSubmission = target === 'SUBMITTED' && sheet.user_id === context.userId;
  const allowed = !!context.user && (target !== 'SUBMITTED' || ownSubmission)
    && await hasApiContextPermission(context, 'time_sheet', transitions[target].permission, trx);
  if (!allowed) {
    throw new ForbiddenError(target === 'SUBMITTED'
      ? 'Permission denied: Can only submit your own time sheets'
      : target === 'APPROVED'
        ? 'Permission denied: Cannot approve time sheets'
        : 'Permission denied: Cannot request changes to time sheets');
  }
  if (!transitions[target].from.includes(sheet.approval_status as Status)) {
    throw new ConflictError(transitions[target].message);
  }

  if (target === 'SUBMITTED') {
    if (!await db.table('time_entries').where({ time_sheet_id: sheetId }).first('entry_id')) {
      throw new ConflictError('Cannot submit time sheet without time entries');
    }
    await db.table('time_sheets').where({ id: sheetId }).update({ approval_status: target, submitted_at: new Date() });
    if (payload.submission_notes) await addHistory(db, sheetId, 'submission', payload.submission_notes, null, context);
    return;
  }

  if (target === 'APPROVED') {
    await assertHumanWorkOwner(trx, context.tenant, context.userId, 'approved_by');
    await db.table('time_sheets').where({ id: sheetId }).update(withViaPrincipal(context, {
      approval_status: target,
      approved_at: new Date(),
      approved_by: context.userId,
    }, 'approved_via_principal_id'));
    if (payload.approval_notes) {
      await addHistory(db, sheetId, 'approval', payload.approval_notes, null, context);
      await addComment(db, sheetId, payload.approval_notes, context, true);
    }
    await db.table('time_entries').where({ time_sheet_id: sheetId }).update({ approval_status: target, updated_at: new Date() });
    return;
  }

  const reason = payload.change_reason;
  if (!reason) throw new ConflictError('A change reason is required');
  const detail = payload.detailed_feedback ?? null;
  await db.table('time_sheets').where({ id: sheetId }).update({ approval_status: target });
  await addHistory(db, sheetId, 'request_changes', reason, detail, context);
  await addComment(db, sheetId, `Changes requested: ${reason}${detail ? `\n\nDetails: ${detail}` : ''}`, context, true);
}

async function addHistory(
  db: ReturnType<typeof tenantDb>,
  sheetId: string,
  kind: 'submission' | 'approval' | 'request_changes',
  note: string,
  detail: string | null,
  context: ServiceContext,
) {
  await db.table('time_sheet_notes').insert({ tenant: context.tenant, time_sheet_id: sheetId, kind, note, detail, created_by: context.userId });
}

async function addComment(db: ReturnType<typeof tenantDb>, sheetId: string, comment: string, context: ServiceContext, isApprover: boolean) {
  await db.table('time_sheet_comments').insert({ comment_id: uuidv4(), tenant: context.tenant, time_sheet_id: sheetId, user_id: context.userId, comment, is_approver: isApprover, created_at: new Date() });
}
