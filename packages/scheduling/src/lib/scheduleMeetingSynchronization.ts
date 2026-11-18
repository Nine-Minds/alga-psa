import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { resolveTeamsMeetingService } from './teamsMeetingService';

export interface ScheduleMeetingSyncOperation {
  action: 'update' | 'delete'; tenantId: string; meetingId: string; eventId: string | null;
  organizerUserId: string | null; appointmentRequestId: string | null;
  startDateTime: string; endDateTime: string;
}
export type ScheduleMeetingSyncDelivery =
  | { status: 'updated' | 'deleted' } | { status: 'skipped'; reason: string } | { status: 'failed'; errorCode: string };

/**
 * Pending calendar-synchronisation intents (written on the `online_meetings` row by the
 * co-managed schedule provider inside the schedule transaction). Discovery lives in the
 * recurring Teams sweep so a crash between local commit and provider execution loses
 * nothing. ONLY called after the sweep's participation check: it reads the
 * `co_managed_sync_*` columns, which a plain PSA schema may not have.
 */
export async function listPendingScheduleMeetingSyncs(db: Knex, tenant: string) {
  const rows = await tenantDb(db, tenant).table('online_meetings').whereNotNull('co_managed_sync_operation_id')
    .whereRaw("(co_managed_sync_attempted_at IS NULL OR co_managed_sync_attempted_at <= clock_timestamp() - (least(3600, power(2, least(co_managed_sync_attempts, 12)) * 30) * interval '1 second'))")
    .orderBy('co_managed_sync_requested_at').orderBy('meeting_id').limit(25).select('meeting_id', 'co_managed_sync_operation_id');
  return rows.map((row: { meeting_id: string; co_managed_sync_operation_id: string }) =>
    ({ meetingId: row.meeting_id, operationId: row.co_managed_sync_operation_id }));
}

/** Provider delivery for one disclosed-meeting operation; idempotent desired-state update/delete. */
export async function scheduleMeetingSyncDelivery(): Promise<(operation: ScheduleMeetingSyncOperation) => Promise<ScheduleMeetingSyncDelivery>> {
  const service = await resolveTeamsMeetingService();
  return operation => {
    const { action, ...input } = operation;
    return action === 'delete' ? service.deleteTeamsMeetingWithResult(input) : service.updateTeamsMeetingWithResult(input);
  };
}
