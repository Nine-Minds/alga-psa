import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { getCoManagedOperationalState } from '@alga-psa/licensing';
import { isCoManagedUuid } from './sharedWorkIdentity';

export interface ScheduleMeetingSyncIdentity { tenant: string; meetingId: string; operationId: string }
export type ScheduleMeetingSyncOperation = {
  action: 'update' | 'delete'; tenantId: string; meetingId: string; eventId: string | null;
  organizerUserId: string | null; appointmentRequestId: string | null;
  startDateTime: string; endDateTime: string;
};
export type ScheduleMeetingSyncOutcome = { status: 'updated' | 'deleted' }
  | { status: 'skipped'; reason: string } | { status: 'failed'; errorCode: string };

/** Trusted maintenance boundary, never a server action. The committed operation
 * is the worker's narrow authority to reconcile an already-disclosed meeting.
 * It cannot create a meeting, change recipients or publish calendar free text.
 * Locking the actual operation through the awaited provider call serializes
 * newer calendar edits and duplicate workers. A crash may repeat the same
 * desired-state update/delete; provider operations must be idempotent. */
export async function synchronizeNativeScheduleMeeting(db: Knex, input: ScheduleMeetingSyncIdentity,
  deliver: (operation: ScheduleMeetingSyncOperation) => Promise<ScheduleMeetingSyncOutcome>) {
  const identity = { ...input };
  if (![identity.tenant, identity.meetingId, identity.operationId].every(isCoManagedUuid)) throw new Error('Invalid schedule meeting synchronization identity');
  return withTransaction(db, async trx => {
    const state = await getCoManagedOperationalState(trx, identity.tenant), owner = tenantDb(trx, identity.tenant);
    const workspace = await owner.table('tenants').forShare().first('tenant', 'suspended_at');
    if (!workspace || workspace.suspended_at || !state.canWrite) return { status: 'deferred' as const };
    const query = () => owner.table('online_meetings').where({ meeting_id: identity.meetingId, co_managed_sync_operation_id: identity.operationId });
    const meeting = await query().forUpdate().first();
    if (!meeting) return { status: 'obsolete' as const };
    const due = await query().whereRaw("(co_managed_sync_attempted_at IS NULL OR co_managed_sync_attempted_at <= clock_timestamp() - (least(3600, power(2, least(co_managed_sync_attempts, 12)) * 30) * interval '1 second'))").first('meeting_id');
    if (!due || !(await getCoManagedOperationalState(trx, identity.tenant)).canWrite) return { status: 'deferred' as const };
    const action = meeting.co_managed_sync_action;
    const start = new Date(meeting.start_time), end = new Date(meeting.end_time);
    // An onlineMeeting ID is not a calendar event ID. Guessing it (or a new
    // configured organizer) can return 404 for the wrong resource and falsely
    // acknowledge a cancellation. Legacy incomplete bindings remain pending.
    const bound = meeting.provider_event_id && (meeting.organizer_user_id || meeting.organizer_upn);
    const valid = bound && meeting.provider === 'teams' && meeting.provider_meeting_id &&
      ((action === 'delete' && meeting.status === 'cancelled') || (action === 'update' && meeting.status !== 'cancelled' && meeting.status !== 'cancel_pending' && start < end));
    let outcome: ScheduleMeetingSyncOutcome;
    if (!valid) outcome = { status: 'failed', errorCode: bound ? 'meeting_state_conflict' : 'provider_binding_incomplete' };
    else {
      try {
        outcome = await deliver({ action, tenantId: identity.tenant, meetingId: meeting.provider_meeting_id,
          eventId: meeting.provider_event_id ?? null, organizerUserId: meeting.organizer_user_id ?? meeting.organizer_upn ?? null,
          appointmentRequestId: meeting.appointment_request_id ?? null, startDateTime: start.toISOString(), endDateTime: end.toISOString() });
      } catch { outcome = { status: 'failed', errorCode: 'provider_exception' }; }
    }
    const succeeded = (action === 'update' && outcome.status === 'updated') || (action === 'delete' && outcome.status === 'deleted');
    // Persist only a bounded diagnostic code, never Graph bodies or transport
    // exceptions that can contain meeting content, URLs or credentials.
    const diagnostic = outcome.status === 'failed' ? outcome.errorCode : outcome.status === 'skipped' ? `skipped_${outcome.reason}` : 'unexpected_provider_result';
    await query().update({
      ...(succeeded ? { co_managed_sync_operation_id: null, co_managed_sync_action: null, co_managed_sync_requested_at: null } : {}),
      co_managed_sync_attempts: Math.min(2147483647, meeting.co_managed_sync_attempts + 1),
      co_managed_sync_attempted_at: trx.fn.now(), co_managed_sync_last_error: succeeded ? null : /^[a-z0-9_]{1,96}$/i.test(diagnostic) ? diagnostic : 'provider_failure',
      updated_at: trx.fn.now(),
    });
    return { status: succeeded ? 'synchronized' as const : 'retry' as const };
  });
}
