'use server';

import type { Knex } from 'knex';
import { createTenantKnex } from '@alga-psa/db';
import { CoManagedSharedWorkError, admitCoManagedNativeTimeSource, lockTimeEntryBillingMode } from '@alga-psa/co-managed';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { permissionError } from '@alga-psa/ui/lib/errorHandling';
import { resolveNativeTimeBrowserActor } from '../lib/nativeTimeReader';
import { StopwatchError } from '../lib/stopwatch/stopwatchErrors';
import { timeSheetActionErrorFrom, type TimeSheetActionError } from './timeSheetActionErrors';
import {
  StopwatchConflictError,
  discardSession,
  getOpenSession,
  pauseSession,
  resumeSession,
  startSession,
  updateSessionDraft,
  type StopwatchSessionView,
} from '../lib/stopwatch/stopwatchCore';

/**
 * Stopwatch server actions (plan section 5). All act on the CALLER's own session; the core
 * scopes every query by user_id = caller, so another user's session id is simply "not found".
 * Expected failures (board disabled, closed session, ...) come back as TimeSheetActionError values.
 */

export type StartStopwatchResult =
  | { session: StopwatchSessionView }
  | { conflict: StopwatchSessionView };

export interface StartStopwatchInput {
  work_item_type: 'ticket' | 'project_task' | 'co_managed';
  work_item_id: string;
  service_id?: string | null;
  notes?: string;
}

function expectedOrThrow(error: unknown): TimeSheetActionError {
  const expected = timeSheetActionErrorFrom(error);
  if (expected) return expected;
  throw error;
}

export const getMyStopwatch = withAuth(async (
  user,
  { tenant },
): Promise<StopwatchSessionView | null | TimeSheetActionError> => {
  const { knex } = await createTenantKnex();
  if (!await hasPermission(user, 'time_entry', 'read', knex)) {
    return permissionError('Permission denied: Cannot read time entries');
  }
  try {
    return await knex.transaction((trx) => getOpenSession(trx, tenant, user.user_id));
  } catch (error) {
    return expectedOrThrow(error);
  }
});

export const startStopwatch = withAuth(async (
  user,
  { tenant },
  input: StartStopwatchInput,
): Promise<StartStopwatchResult | TimeSheetActionError> => {
  const { knex } = await createTenantKnex();
  if (!await hasPermission(user, 'time_entry', 'create', knex)) {
    return permissionError('Permission denied: Cannot create time entries');
  }
  if (input.work_item_type === 'ticket' && !await hasPermission(user, 'ticket', 'read', knex)) {
    return permissionError('Permission denied: Cannot read tickets');
  }
  try {
    const session = await knex.transaction(async (trx) => {
      // Shared work: the same engine guards as a shared time save (live shared update + read
      // authority, staff assignment, lifecycle, entitlement), in this transaction, with the
      // tracked browser session as the actor. The clock is commercial-mode only: operational
      // workspaces track shared effort on their own native timers.
      let access: Awaited<ReturnType<typeof admitCoManagedNativeTimeSource>> | null = null;
      if (input.work_item_type === 'co_managed') {
        if (await lockTimeEntryBillingMode(trx, tenant) !== 'commercial') throw new StopwatchError('unsupportedWorkItem');
        access = await admitCoManagedNativeTimeSource(trx, await resolveNativeTimeBrowserActor(user, tenant),
          { user_id: user.user_id, work_item_id: input.work_item_id, work_item_type: 'co_managed' }, 'create');
      }
      const started = await startSession(trx, tenant, user.user_id, {
        workItemType: input.work_item_type,
        workItemId: input.work_item_id,
        serviceId: input.service_id ?? null,
        notes: input.notes,
      }, { coManagedAdmitted: !!access });
      await access?.assertCurrent();
      return started;
    });
    return { session };
  } catch (error) {
    if (error instanceof StopwatchConflictError) {
      return { conflict: error.openSession };
    }
    if (error instanceof CoManagedSharedWorkError) return permissionError('Permission denied: This shared work is not available for time tracking');
    return expectedOrThrow(error);
  }
});

async function mutateOwnSession(
  user: Parameters<typeof hasPermission>[0],
  run: (trx: Knex.Transaction) => Promise<StopwatchSessionView>,
): Promise<StopwatchSessionView | TimeSheetActionError> {
  const { knex } = await createTenantKnex();
  if (!await hasPermission(user, 'time_entry', 'create', knex)) {
    return permissionError('Permission denied: Cannot create time entries');
  }
  try {
    return await knex.transaction(run);
  } catch (error) {
    return expectedOrThrow(error);
  }
}

export const pauseStopwatch = withAuth(async (user, { tenant }, sessionId: string) =>
  mutateOwnSession(user, (trx) => pauseSession(trx, tenant, user.user_id, sessionId)));

export const resumeStopwatch = withAuth(async (user, { tenant }, sessionId: string) =>
  mutateOwnSession(user, (trx) => resumeSession(trx, tenant, user.user_id, sessionId)));

export const discardStopwatch = withAuth(async (user, { tenant }, sessionId: string) =>
  mutateOwnSession(user, (trx) => discardSession(trx, tenant, user.user_id, sessionId)));

export const updateStopwatchDraft = withAuth(async (
  user,
  { tenant },
  sessionId: string,
  input: { notes?: string; service_id?: string | null },
) =>
  mutateOwnSession(
    user,
    (trx) => updateSessionDraft(trx, tenant, user.user_id, sessionId, {
      notes: input.notes,
      serviceId: input.service_id,
    }),
  ));
