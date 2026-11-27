import { v4 as uuidv4 } from 'uuid';
import { withTransaction, tenantDb } from '@alga-psa/db';
import { assertHumanWorkOwner } from '@alga-psa/shared/lib/humanWork/assertHumanWorkAssignee';
import type { Knex } from 'knex';

/**
 * The time-sheet lifecycle engine. Every native change to a sheet's approval state, and every
 * approver review of its entries, runs through `runTimeSheetTransition`: the tenant-scoped sheet
 * row and its entries are locked first, the actor is authorized against the operation's declared
 * policy, the current state is checked against the operation's rule, and the sheet, entries and
 * history are written in one transaction.
 */

export type TimeSheetLifecycleStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'CHANGES_REQUESTED';

export type TimeSheetLifecycleOperation =
  | 'submit'
  | 'approve'
  | 'requestChanges'
  | 'reverse'
  | 'approveEntries'
  | 'requestEntryChanges';

export type TimeSheetTransitionFailure = 'not_found' | 'wrong_state' | 'invoiced' | 'forbidden' | 'empty';

export class TimeSheetTransitionError extends Error {
  constructor(
    readonly reason: TimeSheetTransitionFailure,
    message: string,
    readonly operation?: TimeSheetLifecycleOperation,
    readonly currentState?: string,
  ) {
    super(message);
    this.name = 'TimeSheetTransitionError';
  }
}

/** @deprecated Reversal failures are ordinary transition failures; kept for existing imports. */
export const TimeSheetReversalError = TimeSheetTransitionError;
export type TimeSheetReversalFailure = TimeSheetTransitionFailure;

export type TimeSheetLifecyclePermission = 'submit' | 'approve' | 'reverse';
export type TimeSheetSubjectRule = 'actOnBehalf' | 'approveSubject';

/**
 * The principal performing a transition. REST and server actions resolve RBAC and delegation
 * differently, so each supplies its own adapter; which checks run is decided by the rule table.
 */
export interface TimeSheetLifecycleActor {
  userId: string;
  hasPermission(permission: TimeSheetLifecyclePermission, trx: Knex.Transaction): Promise<boolean>;
  assertSubject(rule: TimeSheetSubjectRule, subjectUserId: string, trx: Knex.Transaction): Promise<void>;
}

type SheetRow = Record<string, any>;

interface TransitionContext {
  sheet: SheetRow;
  actorId: string;
  now: Date;
  reason?: string;
}

interface TransitionRule {
  /** Sheet states the operation may start from. */
  from: readonly TimeSheetLifecycleStatus[];
  permission: TimeSheetLifecyclePermission;
  subject: TimeSheetSubjectRule;
  /** Approvals must be recorded against a human approver. */
  humanApprover?: boolean;
  /** Refuse when the sheet has no entries. */
  requireEntries?: boolean;
  /** Refuse when any entry in the sheet is invoiced: the result makes the time editable again. */
  refuseInvoicedSheet?: boolean;
  /** Which entries the transition rewrites. */
  entries: 'all' | 'selected';
  entryStatus: TimeSheetLifecycleStatus;
  /** Sheet columns to write, or null to leave the sheet row unchanged. */
  sheetPatch(ctx: TransitionContext): Record<string, unknown> | null;
  /** Approver-authored history is flagged as such. */
  approverHistory: boolean;
  /** History the operation always records, whatever the caller supplies. */
  requiredHistory?(ctx: TransitionContext): string;
  wrongStateMessage(timeSheetId: string, current: string): string;
}

const reopenPatch = (): Record<string, unknown> => ({
  approval_status: 'CHANGES_REQUESTED',
  approved_at: null,
  approved_by: null,
});

const TRANSITIONS: Record<TimeSheetLifecycleOperation, TransitionRule> = {
  submit: {
    from: ['DRAFT', 'CHANGES_REQUESTED'],
    permission: 'submit',
    subject: 'actOnBehalf',
    requireEntries: true,
    entries: 'all',
    entryStatus: 'SUBMITTED',
    sheetPatch: ({ now }) => ({ approval_status: 'SUBMITTED', submitted_at: now }),
    approverHistory: false,
    wrongStateMessage: (_id, current) =>
      `Time sheet cannot be submitted from its current state (current state: ${current})`,
  },
  approve: {
    from: ['SUBMITTED'],
    permission: 'approve',
    subject: 'approveSubject',
    humanApprover: true,
    entries: 'all',
    entryStatus: 'APPROVED',
    sheetPatch: ({ now, actorId }) => ({ approval_status: 'APPROVED', approved_at: now, approved_by: actorId }),
    approverHistory: true,
    wrongStateMessage: (id, current) =>
      `Time sheet ${id} is not in a submitted state (current state: ${current})`,
  },
  requestChanges: {
    from: ['SUBMITTED'],
    permission: 'approve',
    subject: 'actOnBehalf',
    refuseInvoicedSheet: true,
    entries: 'all',
    entryStatus: 'CHANGES_REQUESTED',
    sheetPatch: reopenPatch,
    approverHistory: true,
    wrongStateMessage: (_id, current) =>
      `Changes can only be requested on a submitted time sheet (current state: ${current})`,
  },
  reverse: {
    from: ['APPROVED'],
    permission: 'reverse',
    subject: 'actOnBehalf',
    refuseInvoicedSheet: true,
    entries: 'all',
    entryStatus: 'CHANGES_REQUESTED',
    sheetPatch: ({ now, actorId, reason }) => ({
      ...reopenPatch(),
      reversal_reason: reason,
      reversed_at: now,
      reversed_by: actorId,
    }),
    approverHistory: true,
    requiredHistory: ({ reason }) => `Approval reversed: ${reason}`,
    wrongStateMessage: () => 'Time sheet is not in an approved state',
  },
  approveEntries: {
    from: ['SUBMITTED', 'CHANGES_REQUESTED'],
    permission: 'approve',
    subject: 'approveSubject',
    humanApprover: true,
    entries: 'selected',
    entryStatus: 'APPROVED',
    sheetPatch: () => null,
    approverHistory: true,
    wrongStateMessage: (_id, current) =>
      `Time entries can only be reviewed on a submitted time sheet (current state: ${current})`,
  },
  requestEntryChanges: {
    from: ['SUBMITTED', 'CHANGES_REQUESTED'],
    permission: 'approve',
    subject: 'actOnBehalf',
    refuseInvoicedSheet: true,
    entries: 'selected',
    entryStatus: 'CHANGES_REQUESTED',
    // The first entry sent back returns the submitted sheet to its owner.
    sheetPatch: ({ sheet }) => (sheet.approval_status === 'SUBMITTED' ? reopenPatch() : null),
    approverHistory: true,
    wrongStateMessage: (_id, current) =>
      `Time entries can only be reviewed on a submitted time sheet (current state: ${current})`,
  },
};

const PERMISSION_DENIED: Record<TimeSheetLifecycleOperation, string> = {
  submit: 'Permission denied: Cannot submit timesheets',
  approve: 'Permission denied: Cannot approve timesheets',
  requestChanges: 'Permission denied: Cannot request changes for timesheets',
  reverse: 'Permission denied: Cannot reverse timesheet approvals',
  approveEntries: 'Permission denied: Cannot update time entry approval status',
  requestEntryChanges: 'Permission denied: Cannot update time entry approval status',
};

export interface TimeSheetTransitionResult {
  timeSheetId: string;
  employeeId: string;
  previousStatus: TimeSheetLifecycleStatus;
  sheet: SheetRow;
  entryCount: number | string;
  totalHours: number | string | null;
}

export async function runTimeSheetTransition(input: {
  /** A connection or an enclosing transaction; an enclosing transaction is reused. */
  knex: Knex | Knex.Transaction;
  tenant: string;
  timeSheetId: string;
  operation: TimeSheetLifecycleOperation;
  actor: TimeSheetLifecycleActor;
  /** History comment written with the transition. */
  comment?: string;
  /** Reversal reason (reverse only). */
  reason?: string;
  /** Entries under review (entry operations only). */
  entryIds?: string[];
}): Promise<TimeSheetTransitionResult> {
  const { knex, tenant, timeSheetId, operation, actor, comment, reason } = input;
  const rule = TRANSITIONS[operation];
  let result!: TimeSheetTransitionResult;

  await withTransaction(knex as Knex, async (trx) => {
    const scopedDb = tenantDb(trx, tenant);
    // Lock order shared with invoicing: the sheet row first, then every entry in the sheet.
    const sheet = await scopedDb.table('time_sheets').where({ id: timeSheetId }).forUpdate().first();
    if (!sheet) throw new TimeSheetTransitionError('not_found', 'Time sheet not found', operation);
    const entries = () => scopedDb.table('time_entries').where({ time_sheet_id: timeSheetId });
    const lockedEntries: Array<{ entry_id: string; invoiced: boolean }> =
      await entries().forUpdate().select('entry_id', 'invoiced');

    if (!await actor.hasPermission(rule.permission, trx)) {
      throw new TimeSheetTransitionError('forbidden', PERMISSION_DENIED[operation], operation);
    }
    await actor.assertSubject(rule.subject, sheet.user_id, trx);
    if (rule.humanApprover) {
      await assertHumanWorkOwner(trx, tenant, actor.userId, 'approved_by');
    }

    const current = sheet.approval_status as TimeSheetLifecycleStatus;
    if (!rule.from.includes(current)) {
      throw new TimeSheetTransitionError('wrong_state', rule.wrongStateMessage(timeSheetId, current), operation, current);
    }

    let targetIds: string[];
    if (rule.entries === 'selected') {
      const selected = [...new Set(input.entryIds ?? [])];
      const inSheet = new Map(lockedEntries.map((entry) => [entry.entry_id, entry]));
      if (selected.length === 0 || selected.some((id) => !inSheet.has(id))) {
        throw new TimeSheetTransitionError('not_found', 'Time entry not found', operation, current);
      }
      const selectedLinked = await scopedDb.table('invoice_time_entries').whereIn('entry_id', selected).first('entry_id');
      if (selected.some((id) => inSheet.get(id)!.invoiced) || selectedLinked) {
        throw new TimeSheetTransitionError('invoiced', 'This time entry has already been invoiced and cannot be modified.', operation, current);
      }
      targetIds = selected;
    } else {
      targetIds = lockedEntries.map((entry) => entry.entry_id);
    }

    if (rule.requireEntries && lockedEntries.length === 0) {
      throw new TimeSheetTransitionError('empty', 'Cannot submit time sheet without time entries', operation, current);
    }
    if (rule.refuseInvoicedSheet) {
      const sheetEntryIds = lockedEntries.map((entry) => entry.entry_id);
      const linked = sheetEntryIds.length
        ? await scopedDb.table('invoice_time_entries').whereIn('entry_id', sheetEntryIds).first('entry_id')
        : undefined;
      if (lockedEntries.some((entry) => entry.invoiced) || linked) {
        throw new TimeSheetTransitionError('invoiced', 'This time sheet contains invoiced time and cannot be reopened.', operation, current);
      }
    }

    const now = new Date();
    const patch = rule.sheetPatch({ sheet, actorId: actor.userId, now, reason });
    let updatedSheet: SheetRow = sheet;
    if (patch) {
      [updatedSheet] = await scopedDb.table('time_sheets').where({ id: timeSheetId }).update(patch).returning('*');
    }
    if (targetIds.length) {
      await entries().whereIn('entry_id', targetIds).update({
        approval_status: rule.entryStatus,
        updated_at: now,
        ...(rule.entries === 'selected' ? { updated_by: actor.userId } : {}),
      });
    }
    const history = rule.requiredHistory?.({ sheet, actorId: actor.userId, now, reason }) ?? comment;
    if (history) {
      await scopedDb.table('time_sheet_comments').insert({
        comment_id: uuidv4(),
        time_sheet_id: timeSheetId,
        user_id: actor.userId,
        comment: history,
        created_at: trx.fn.now(),
        is_approver: rule.approverHistory,
        tenant,
      });
    }

    const totals = await entries()
      .select(trx.raw('COUNT(*) as entry_count'), trx.raw('SUM(billable_duration) / 60 as total_hours'))
      .first();
    result = {
      timeSheetId,
      employeeId: sheet.user_id,
      previousStatus: current,
      sheet: updatedSheet,
      entryCount: totals?.entry_count ?? 0,
      totalHours: totals?.total_hours ?? 0,
    };
  });

  return result;
}

export interface TimeSheetApprovalResult {
  timeSheetId: string;
  employeeId: string;
  entryCount: number | string;
  totalHours: number | string | null;
}

/** Approve a submitted sheet through the lifecycle engine. */
export async function approveSubmittedTimeSheet(input: {
  knex: Knex | Knex.Transaction;
  tenant: string;
  timeSheetId: string;
  actor: TimeSheetLifecycleActor;
  comment?: string;
}): Promise<TimeSheetApprovalResult> {
  const { timeSheetId, employeeId, entryCount, totalHours } = await runTimeSheetTransition({ ...input, operation: 'approve' });
  return { timeSheetId, employeeId, entryCount, totalHours };
}

/** Reopen an approved, uninvoiced sheet through the lifecycle engine. */
export async function reverseApprovedTimeSheet(input: {
  knex: Knex | Knex.Transaction;
  tenant: string;
  timeSheetId: string;
  actor: TimeSheetLifecycleActor;
  reason: string;
}): Promise<void> {
  await runTimeSheetTransition({ ...input, operation: 'reverse' });
}
