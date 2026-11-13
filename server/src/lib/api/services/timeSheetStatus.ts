/**
 * Time-sheet approval status transitions (alga-2026-0003017).
 *
 * `time_sheets.approval_status` is derived state, not a writable column. Every status change runs exactly one
 * transition from this table, and each transition carries a capability check, a from-state precondition and the
 * side effects that give the new state its meaning. Callers may request a transition; none may write the column.
 */

import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb, withViaPrincipal, type ServiceContext } from '@alga-psa/db';
import { assertHumanWorkOwner } from '@alga-psa/shared/lib/humanWork/assertHumanWorkAssignee';
import { hasApiContextPermission } from '../middleware/apiContextPermission';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../middleware/apiMiddleware';

export type TimeSheetStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'CHANGES_REQUESTED';
export type TransitionTarget = 'SUBMITTED' | 'APPROVED' | 'CHANGES_REQUESTED';
export type TransitionCapability = 'submit-own' | 'approve';

export interface TransitionPayload {
  submission_notes?: string;
  approval_notes?: string;
  change_reason?: string;
  detailed_feedback?: string;
}

export interface TransitionDescriptor {
  target: TransitionTarget;
  from: readonly TimeSheetStatus[];
  capability: TransitionCapability;
  forbiddenMessage: string;
  conflictMessage: string;
  requiredPayload?: readonly (keyof TransitionPayload)[];
}

export const TIME_SHEET_TRANSITIONS: Readonly<Record<TransitionTarget, TransitionDescriptor>> = {
  SUBMITTED: {
    target: 'SUBMITTED', from: ['DRAFT', 'CHANGES_REQUESTED'], capability: 'submit-own',
    forbiddenMessage: 'Permission denied: Can only submit your own time sheets',
    conflictMessage: 'Time sheet can only be submitted from DRAFT or CHANGES_REQUESTED status',
  },
  APPROVED: {
    target: 'APPROVED', from: ['SUBMITTED'], capability: 'approve',
    forbiddenMessage: 'Permission denied: Cannot approve time sheets',
    conflictMessage: 'Time sheet must be submitted before approval',
  },
  CHANGES_REQUESTED: {
    target: 'CHANGES_REQUESTED', from: ['SUBMITTED'], capability: 'approve',
    forbiddenMessage: 'Permission denied: Cannot request changes to time sheets',
    conflictMessage: 'Time sheet must be submitted before requesting changes',
    requiredPayload: ['change_reason'],
  },
};

export function findTransition(target: string): TransitionDescriptor {
  const descriptor = (TIME_SHEET_TRANSITIONS as Record<string, TransitionDescriptor | undefined>)[target];
  if (!descriptor) throw new ConflictError(`Time sheet status cannot be set to ${target} directly`);
  return descriptor;
}

export function resolveTransition(sheet: { approval_status: string }, target: string): TransitionDescriptor {
  const descriptor = findTransition(target);
  if (!descriptor.from.includes(sheet.approval_status as TimeSheetStatus)) throw new ConflictError(descriptor.conflictMessage);
  return descriptor;
}

export async function assertTransitionCapability(
  trx: Knex.Transaction,
  sheet: { user_id: string },
  descriptor: TransitionDescriptor,
  context: ServiceContext,
): Promise<void> {
  const allowed = descriptor.capability === 'submit-own'
    ? sheet.user_id === context.userId && !!context.user && await hasApiContextPermission(context, 'time_sheet', 'update', trx)
    : !!context.user && await hasApiContextPermission(context, 'time_sheet', 'approve', trx);
  if (!allowed) throw new ForbiddenError(descriptor.forbiddenMessage);
}

function assertTransitionPayload(descriptor: TransitionDescriptor, payload: TransitionPayload): void {
  for (const field of descriptor.requiredPayload ?? []) {
    const value = payload[field];
    if (typeof value !== 'string' || value.trim() === '') {
      throw new ValidationError(`${field} is required to move a time sheet to ${descriptor.target}`, { field });
    }
  }
}

async function insertComment(
  trx: Knex.Transaction,
  sheetId: string,
  comment: string,
  isApprover: boolean,
  context: ServiceContext,
) {
  await tenantDb(trx, context.tenant).table('time_sheet_comments').insert({
    comment_id: uuidv4(), time_sheet_id: sheetId, user_id: context.userId, comment,
    is_approver: isApprover, created_at: trx.fn.now(), tenant: context.tenant,
  });
}

async function insertHistory(
  trx: Knex.Transaction,
  sheetId: string,
  kind: 'submission' | 'approval' | 'request_changes',
  note: string,
  detail: string | null,
  context: ServiceContext,
) {
  await tenantDb(trx, context.tenant).table('time_sheet_notes').insert({
    tenant: context.tenant, time_sheet_id: sheetId, kind, note, detail, created_by: context.userId,
  });
}

export async function applyTransition(
  trx: Knex.Transaction,
  sheet: { id: string },
  descriptor: TransitionDescriptor,
  context: ServiceContext,
  payload: TransitionPayload = {},
): Promise<void> {
  assertTransitionPayload(descriptor, payload);
  const db = tenantDb(trx, context.tenant);
  const sheets = () => db.table('time_sheets').where({ id: sheet.id });

  switch (descriptor.target) {
    case 'SUBMITTED': {
      if (!await db.table('time_entries').where({ time_sheet_id: sheet.id }).first('entry_id')) {
        throw new ConflictError('Cannot submit time sheet without time entries');
      }
      await sheets().update({ approval_status: 'SUBMITTED', submitted_at: new Date() });
      if (payload.submission_notes?.trim()) {
        await insertHistory(trx, sheet.id, 'submission', payload.submission_notes, null, context);
        await insertComment(trx, sheet.id, payload.submission_notes, false, context);
      }
      return;
    }
    case 'APPROVED': {
      await assertHumanWorkOwner(trx, context.tenant, context.userId, 'approved_by');
      await sheets().update(withViaPrincipal(context, {
        approval_status: 'APPROVED', approved_at: new Date(), approved_by: context.userId,
      }, 'approved_via_principal_id'));
      if (payload.approval_notes) {
        await insertHistory(trx, sheet.id, 'approval', payload.approval_notes, null, context);
        await insertComment(trx, sheet.id, payload.approval_notes, true, context);
      }
      await db.table('time_entries').where({ time_sheet_id: sheet.id }).update({ approval_status: 'APPROVED', updated_at: new Date() });
      return;
    }
    case 'CHANGES_REQUESTED': {
      await sheets().update({ approval_status: 'CHANGES_REQUESTED' });
      const details = payload.detailed_feedback ? `\n\nDetails: ${payload.detailed_feedback}` : '';
      await insertHistory(trx, sheet.id, 'request_changes', payload.change_reason!, payload.detailed_feedback ?? null, context);
      await insertComment(trx, sheet.id, `Changes requested: ${payload.change_reason}${details}`, true, context);
      return;
    }
  }
}

/** Capability is checked before state, preserving 403-before-409 behavior. */
export async function transitionTimeSheet(
  trx: Knex.Transaction,
  sheet: { id: string; user_id: string; approval_status: string },
  target: string,
  context: ServiceContext,
  payload: TransitionPayload = {},
): Promise<void> {
  const descriptor = findTransition(target);
  const lockedSheet = await tenantDb(trx, context.tenant).table('time_sheets')
    .where({ id: sheet.id }).forUpdate().first('id', 'user_id', 'approval_status');
  if (!lockedSheet) throw new NotFoundError('Time sheet not found');
  await assertTransitionCapability(trx, lockedSheet, descriptor, context);
  resolveTransition(lockedSheet, target);
  await applyTransition(trx, lockedSheet, descriptor, context, payload);
}
