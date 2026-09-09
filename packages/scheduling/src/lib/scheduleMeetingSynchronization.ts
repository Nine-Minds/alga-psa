import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { synchronizeNativeScheduleMeeting } from '@alga-psa/co-managed';
import { resolveTeamsMeetingService } from './teamsMeetingService';

/** Existing recurring Teams maintenance discovers committed operations, so a
 * process crash between the local commit and provider execution loses no work.
 * Only identities cross into the retained domain consumer. */
export async function synchronizeCoManagedScheduleMeetings(db: Knex, tenant: string) {
  const pending = await tenantDb(db, tenant).table('online_meetings').whereNotNull('co_managed_sync_operation_id')
    .whereRaw("(co_managed_sync_attempted_at IS NULL OR co_managed_sync_attempted_at <= clock_timestamp() - (least(3600, power(2, least(co_managed_sync_attempts, 12)) * 30) * interval '1 second'))")
    .orderBy('co_managed_sync_requested_at').orderBy('meeting_id').limit(25).select('meeting_id', 'co_managed_sync_operation_id');
  if (!pending.length) return [];
  const provider = await resolveTeamsMeetingService();
  const results: Awaited<ReturnType<typeof synchronizeNativeScheduleMeeting>>[] = [];
  for (const row of pending) results.push(await synchronizeNativeScheduleMeeting(db, {
    tenant, meetingId: row.meeting_id, operationId: row.co_managed_sync_operation_id,
  }, operation => {
    const { action, ...input } = operation;
    return action === 'delete' ? provider.deleteTeamsMeetingWithResult(input) : provider.updateTeamsMeetingWithResult(input);
  }));
  return results;
}
