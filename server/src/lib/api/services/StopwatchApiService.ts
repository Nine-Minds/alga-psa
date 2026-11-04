/**
 * Stopwatch API Service
 * Thin REST layer over the server-side stopwatch core (@alga-psa/scheduling). Every method opens a
 * transaction and delegates to stopwatchCore; the controller owns authentication and RBAC.
 */

import { BaseService, type ServiceContext } from '@alga-psa/db';
import type { IUser } from '@alga-psa/types';
import {
  StopwatchConflictError,
  StopwatchError,
  discardSession,
  getOpenSession,
  logSession,
  pauseSession,
  resumeSession,
  startSession,
  updateSessionDraft,
  type StopwatchSessionView,
} from '@alga-psa/scheduling/lib/stopwatch/stopwatchCore';
import { publishPersistedTimeEntryEvents, type PersistedTimeEntry } from '@alga-psa/scheduling/lib/timeEntryWriteCore';
import { timeSheetActionErrorFrom } from '@alga-psa/scheduling/actions/timeSheetActionErrors';
import { assertCanActOnBehalf } from '@alga-psa/scheduling/actions/timeEntryDelegationAuth';
import { publishWorkflowEvent } from 'server/src/lib/eventBus/publishers';
import { buildTicketTimeEntryAddedWorkflowEvent } from './timeEntryWorkflowEvents';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../middleware/apiMiddleware';
import type {
  LogStopwatchData,
  StartStopwatchData,
  UpdateStopwatchData,
} from '../schemas/stopwatch';

const CONFLICT_KEYS = new Set([
  'msp/time-entry:errors.stopwatch.notOpen',
  'msp/time-entry:errors.stopwatch.boardDisabled',
  'msp/time-entry:workItemEntry.save.sheetLocked',
  'msp/time-entry:errors.timeSheet.notEditable',
  'msp/time-entry:errors.timeEntry.alreadyInvoiced',
  'msp/time-entry:errors.timeEntry.duplicate',
]);

const NOT_FOUND_KEYS = new Set([
  'msp/time-entry:errors.stopwatch.notFound',
  'msp/time-entry:errors.stopwatch.workItemNotFound',
  'msp/time-entry:errors.timeSheet.notFoundRefresh',
]);

/**
 * Translate an expected stopwatch / write-core failure into the API error the middleware renders.
 * Unexpected errors are returned untouched (they become 500s). Always `throw mapStopwatchError(e)`.
 *
 * - open session already exists            -> 409, details.open_session
 * - closed session, board disabled, locked sheet -> 409, details.reason = i18n key
 * - session / work item / sheet not found  -> 404
 * - permission failures                    -> 403
 * - everything else expected               -> 400
 */
export function mapStopwatchError(error: unknown): unknown {
  if (error instanceof StopwatchConflictError) {
    return new ConflictError(
      'An open stopwatch session already exists. Log or discard it before starting another.',
      { reason: 'open_session_exists', open_session: error.openSession },
    );
  }
  const expectedError = timeSheetActionErrorFrom(error);
  if (!expectedError) return error;
  const expected = expectedError as { permissionError?: string; actionError?: string; messageKey?: string };
  if (expected.permissionError !== undefined) {
    return new ForbiddenError(expected.permissionError);
  }
  const message = expected.actionError ?? 'Stopwatch request failed';
  const reason = expected.messageKey;
  const details = reason ? { reason } : undefined;
  if (reason && CONFLICT_KEYS.has(reason)) {
    return new ConflictError(message, details);
  }
  if ((reason && NOT_FOUND_KEYS.has(reason)) || (error instanceof StopwatchError && error.kind === 'notFound')) {
    return new NotFoundError(message);
  }
  return new ValidationError(message, details);
}

/**
 * Post-commit events a logged session owes: the search event (via the write core) and, like the
 * other API write paths, the ticket-time-entry-added workflow event. Best-effort.
 */
export async function publishLoggedSessionEvents(
  persisted: PersistedTimeEntry,
  context: ServiceContext,
): Promise<void> {
  await publishPersistedTimeEntryEvents(persisted);
  const entry = persisted.entry;
  const minutes = Math.round((new Date(entry.end_time).getTime() - new Date(entry.start_time).getTime()) / 60_000);
  const event = buildTicketTimeEntryAddedWorkflowEvent({
    workItemType: entry.work_item_type,
    workItemId: entry.work_item_id,
    timeEntryId: entry.entry_id as string,
    minutes,
    billable: persisted.finalBillableDuration > 0,
    createdAt: (entry.created_at as unknown as string | Date | null | undefined) ?? undefined,
  });
  if (!event) return;
  try {
    await publishWorkflowEvent({
      eventType: event.eventType,
      payload: event.payload,
      ctx: {
        tenantId: context.tenant,
        occurredAt: new Date(),
        actor: { actorType: 'USER', actorUserId: context.userId },
      },
    });
  } catch (error) {
    console.error('Failed to publish ticket time entry added workflow event', error);
  }
}

export class StopwatchApiService extends BaseService<never> {
  constructor() {
    super({
      tableName: 'time_tracking_sessions',
      primaryKey: 'session_id',
      tenantColumn: 'tenant',
    });
  }

  /**
   * The open (running/paused) session of `targetUserId` (default: the caller), or null.
   * Reading another user's session requires the same delegation rights as acting on their time.
   */
  async getActive(context: ServiceContext, targetUserId?: string): Promise<StopwatchSessionView | null> {
    const db = await this.getDbForContext(context);
    const subject = targetUserId ?? context.userId;
    try {
      if (subject !== context.userId) {
        await assertCanActOnBehalf(context.user as IUser, context.tenant, subject, db);
      }
      return await db.transaction((trx) => getOpenSession(trx, context.tenant, subject));
    } catch (error) {
      throw mapStopwatchError(error);
    }
  }

  async start(data: StartStopwatchData, context: ServiceContext): Promise<StopwatchSessionView> {
    const db = await this.getDbForContext(context);
    try {
      return await db.transaction((trx) =>
        startSession(trx, context.tenant, context.userId, {
          workItemType: data.work_item_type,
          workItemId: data.work_item_id,
          serviceId: data.service_id ?? null,
          notes: data.notes,
        }),
      );
    } catch (error) {
      throw mapStopwatchError(error);
    }
  }

  async pause(sessionId: string, context: ServiceContext): Promise<StopwatchSessionView> {
    const db = await this.getDbForContext(context);
    try {
      return await db.transaction((trx) => pauseSession(trx, context.tenant, context.userId, sessionId));
    } catch (error) {
      throw mapStopwatchError(error);
    }
  }

  async resume(sessionId: string, context: ServiceContext): Promise<StopwatchSessionView> {
    const db = await this.getDbForContext(context);
    try {
      return await db.transaction((trx) => resumeSession(trx, context.tenant, context.userId, sessionId));
    } catch (error) {
      throw mapStopwatchError(error);
    }
  }

  async updateDraft(sessionId: string, data: UpdateStopwatchData, context: ServiceContext): Promise<StopwatchSessionView> {
    const db = await this.getDbForContext(context);
    try {
      return await db.transaction((trx) =>
        updateSessionDraft(trx, context.tenant, context.userId, sessionId, {
          notes: data.notes,
          serviceId: data.service_id,
        }),
      );
    } catch (error) {
      throw mapStopwatchError(error);
    }
  }

  async discard(sessionId: string, context: ServiceContext): Promise<void> {
    const db = await this.getDbForContext(context);
    try {
      await db.transaction((trx) => discardSession(trx, context.tenant, context.userId, sessionId));
    } catch (error) {
      throw mapStopwatchError(error);
    }
  }

  /** Log the session as one time entry; returns the closed session and the persisted entry row. */
  async log(
    sessionId: string,
    data: LogStopwatchData,
    context: ServiceContext,
  ): Promise<{ session: StopwatchSessionView; time_entry: Record<string, unknown> }> {
    const db = await this.getDbForContext(context);
    let result;
    try {
      result = await db.transaction((trx) =>
        logSession(trx, context.tenant, context.user as IUser, sessionId, data),
      );
    } catch (error) {
      throw mapStopwatchError(error);
    }
    // After commit, exactly like saveTimeEntry.
    await publishLoggedSessionEvents(result.persisted, context);
    return { session: result.session, time_entry: result.persisted.entry as unknown as Record<string, unknown> };
  }
}
