/**
 * Time-sheet approval status transitions (alga-2026-0003017).
 *
 * `time_sheets.approval_status` is derived state, not a writable column. Every status change runs exactly one
 * transition from this table, and each transition carries (a) a capability check, (b) a from-state precondition and
 * (c) the side effects that give the new state its meaning. Callers (the dedicated verbs and `update`) may
 * *request* a transition; none may write the column directly.
 *
 * Ordering contract for callers: findTransition -> assertTransitionCapability -> resolveTransition (from-state)
 * -> applyTransition. Capability is checked before the from-state so an unauthorised caller learns nothing about
 * the sheet's state (403 before 409), matching the pre-existing verbs.
 */

import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb, type ServiceContext } from '@alga-psa/db';
import { assertHumanWorkOwner } from '@alga-psa/shared/lib/humanWork/assertHumanWorkAssignee';
import { hasPermission } from '../../auth/rbac';
import { ConflictError, ForbiddenError, ValidationError } from '../middleware/apiMiddleware';

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
  /** Message of the ForbiddenError when the capability check fails. */
  forbiddenMessage: string;
  /** Message of the ConflictError when the sheet is not in an allowed from-state. */
  conflictMessage: string;
  /** Payload fields that must be non-blank; checked by applyTransition before any write (400). */
  requiredPayload?: readonly (keyof TransitionPayload)[];
}

export const TIME_SHEET_TRANSITIONS: Readonly<Record<TransitionTarget, TransitionDescriptor>> = {
  SUBMITTED: {
    target: 'SUBMITTED',
    from: ['DRAFT', 'CHANGES_REQUESTED'],
    capability: 'submit-own',
    forbiddenMessage: 'Permission denied: Can only submit your own time sheets',
    conflictMessage: 'Time sheet can only be submitted from DRAFT or CHANGES_REQUESTED status',
  },
  APPROVED: {
    target: 'APPROVED',
    from: ['SUBMITTED'],
    capability: 'approve',
    forbiddenMessage: 'Permission denied: Cannot approve time sheets',
    conflictMessage: 'Time sheet must be submitted before approval',
  },
  CHANGES_REQUESTED: {
    target: 'CHANGES_REQUESTED',
    from: ['SUBMITTED'],
    capability: 'approve',
    forbiddenMessage: 'Permission denied: Cannot request changes to time sheets',
    conflictMessage: 'Time sheet must be submitted before requesting changes',
    requiredPayload: ['change_reason'],
  },
};

/** Look up the transition for a target status. A target outside the table (e.g. DRAFT) is a 409. */
export function findTransition(target: string): TransitionDescriptor {
  const descriptor = (TIME_SHEET_TRANSITIONS as Record<string, TransitionDescriptor | undefined>)[target];
  if (!descriptor) {
    throw new ConflictError(`Time sheet status cannot be set to ${target} directly`);
  }
  return descriptor;
}

/** Resolve the transition and enforce its from-state precondition. */
export function resolveTransition(sheet: { approval_status: string }, target: string): TransitionDescriptor {
  const descriptor = findTransition(target);
  if (!descriptor.from.includes(sheet.approval_status as TimeSheetStatus)) {
    throw new ConflictError(descriptor.conflictMessage);
  }
  return descriptor;
}

/** Capability check for a transition. Throws ForbiddenError (403). */
export async function assertTransitionCapability(
  trx: Knex.Transaction,
  sheet: { user_id: string },
  descriptor: TransitionDescriptor,
  context: ServiceContext
): Promise<void> {
  let allowed: boolean;
  if (descriptor.capability === 'submit-own') {
    allowed =
      sheet.user_id === context.userId &&
      !!context.user &&
      (await hasPermission(context.user, 'time_sheet', 'update', trx));
  } else {
    allowed = !!context.user && (await hasPermission(context.user, 'time_sheet', 'approve', trx));
  }
  if (!allowed) {
    throw new ForbiddenError(descriptor.forbiddenMessage);
  }
}

/** Reject (400) a payload missing a field the transition requires. Pure: runs before any write. */
function assertTransitionPayload(descriptor: TransitionDescriptor, payload: TransitionPayload): void {
  for (const field of descriptor.requiredPayload ?? []) {
    const value = payload[field];
    if (typeof value !== 'string' || value.trim() === '') {
      throw new ValidationError(`${field} is required to move a time sheet to ${descriptor.target}`, { field });
    }
  }
}

/**
 * time_sheets has neither approval/submission notes nor updated_at; transition notes live in time_sheet_comments
 * (same shape the workflow runtime writes). `isApprover` is true for approver notes and false for the submitter's.
 */
async function insertComment(
  trx: Knex.Transaction,
  sheetId: string,
  comment: string,
  isApprover: boolean,
  context: ServiceContext
) {
  await tenantDb(trx, context.tenant).table('time_sheet_comments').insert({
    comment_id: uuidv4(),
    time_sheet_id: sheetId,
    user_id: context.userId,
    comment,
    is_approver: isApprover,
    created_at: trx.fn.now(),
    tenant: context.tenant,
  });
}

/** Write the new status and the side effects that give it meaning. Runs inside the caller's transaction. */
export async function applyTransition(
  trx: Knex.Transaction,
  sheet: { id: string },
  descriptor: TransitionDescriptor,
  context: ServiceContext,
  payload: TransitionPayload = {}
): Promise<void> {
  assertTransitionPayload(descriptor, payload);
  const db = tenantDb(trx, context.tenant);
  const sheets = () => db.table('time_sheets').where({ id: sheet.id });

  switch (descriptor.target) {
    case 'SUBMITTED': {
      const entry = await db.table('time_entries').where({ time_sheet_id: sheet.id }).first();
      if (!entry) {
        throw new ConflictError('Cannot submit time sheet without time entries');
      }
      await sheets().update({
        approval_status: 'SUBMITTED',
        submitted_at: new Date(),
      });
      if (payload.submission_notes?.trim()) {
        await insertComment(trx, sheet.id, payload.submission_notes, false, context);
      }
      return;
    }
    case 'APPROVED': {
      // Human-work guard: approval requires a human approver.
      await assertHumanWorkOwner(trx, context.tenant, context.userId, 'approved_by');
      await sheets().update({
        approval_status: 'APPROVED',
        approved_at: new Date(),
        approved_by: context.userId,
      });
      if (payload.approval_notes) {
        await insertComment(trx, sheet.id, payload.approval_notes, true, context);
      }
      // time_entries has no approved_at/approved_by columns (they live on time_sheets).
      await db.table('time_entries').where({ time_sheet_id: sheet.id }).update({
        approval_status: 'APPROVED',
        updated_at: new Date(),
      });
      return;
    }
    case 'CHANGES_REQUESTED': {
      await sheets().update({
        approval_status: 'CHANGES_REQUESTED',
      });
      const details = payload.detailed_feedback ? `\n\nDetails: ${payload.detailed_feedback}` : '';
      await insertComment(trx, sheet.id, `Changes requested: ${payload.change_reason}${details}`, true, context);
      return;
    }
  }
}

/** The full guarded sequence every consumer runs: find -> capability (403) -> from-state (409) -> apply. */
export async function transitionTimeSheet(
  trx: Knex.Transaction,
  sheet: { id: string; user_id: string; approval_status: string },
  target: string,
  context: ServiceContext,
  payload: TransitionPayload = {}
): Promise<void> {
  const descriptor = findTransition(target);
  await assertTransitionCapability(trx, sheet, descriptor, context);
  resolveTransition(sheet, target);
  await applyTransition(trx, sheet, descriptor, context, payload);
}
