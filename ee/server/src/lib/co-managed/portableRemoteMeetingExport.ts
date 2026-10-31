import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { portableSnapshotTransaction } from '../../../../../packages/co-managed/src/portableSnapshot';
import { validatePortableRecordSection, type PortableRecords } from '../../../../../packages/co-managed/src/portableRecordValidation';
import type { PortableContributor } from '../../../../../packages/co-managed/src/portableContributorRegistry';
import { withCoManagedExportAdmin } from '../../../../../packages/co-managed/src/portableExport';
import { hasCoManagedLocalPermission } from '../../../../../packages/co-managed/src/localPermission';
import { CoManagedSharedWorkError, isCoManagedUuid, snapshotCoManagedSessionActor, type CoManagedSessionActor } from '../../../../../packages/co-managed/src/sharedWorkIdentity';

/** Meeting metadata and join links. Provider identities (provider_meeting_id,
 * provider_event_id, organizer_upn, organizer_user_id) and the recordings and
 * transcripts themselves are not exported: the stored files travel with the
 * artifact contributor, and provider-only artifacts are never fetched. */
export const CO_MANAGED_PORTABLE_MEETING_COLUMNS = {
  online_meetings: ['meeting_id', 'provider', 'subject', 'join_url', 'start_time', 'end_time', 'status', 'appointment_request_id', 'interaction_id', 'schedule_entry_id', 'created_by', 'created_at', 'updated_at'],
} as const;
export const CO_MANAGED_PORTABLE_MEETING_REFERENCES = [
  ['online_meetings', 'appointment_request_id', 'appointment_requests', 'appointment_request_id'],
  ['online_meetings', 'interaction_id', 'interactions', 'interaction_id'],
  ['online_meetings', 'schedule_entry_id', 'schedule_entries', 'entry_id'],
] as const;

export interface PortableMeetingAttendance {
  meeting_id: string; attendee_email: string | null; attendee_name: string | null; role: string | null;
  total_attendance_seconds: number | null; first_joined_at: string | null; last_left_at: string | null;
}
/** Reads attendance from the meeting provider. It runs OUTSIDE any database
 * transaction (provider work never holds a lock) and receives only meeting ids
 * and the provider name, never credentials. There is no attendance reader in
 * the Teams package, and this export adds no Graph client of its own: a caller
 * with a real reader injects it. Without one, attendance is an explicit exclusion. */
export type PortableMeetingAttendanceResolver = (tenant: string, meetings: readonly { meeting_id: string; provider: string }[]) => Promise<readonly PortableMeetingAttendance[]>;

const LIMIT = 100_000;
const ATTENDANCE_KEYS = ['meeting_id', 'attendee_email', 'attendee_name', 'role', 'total_attendance_seconds', 'first_joined_at', 'last_left_at'] as const;

export function validateCoManagedPortableMeetingRecords(input: unknown): asserts input is PortableRecords {
  validatePortableRecordSection(input, { columns: CO_MANAGED_PORTABLE_MEETING_COLUMNS, references: CO_MANAGED_PORTABLE_MEETING_REFERENCES });
  for (const row of (input as PortableRecords).online_meetings) {
    if (!row.interaction_id && !row.appointment_request_id && !row.schedule_entry_id) throw new Error('Portable meeting source is missing');
  }
}

async function retain(trx: Knex.Transaction, inputActor: CoManagedSessionActor, packageId: string) {
  if (!trx.isTransaction) throw new Error('Portable retention requires a transaction');
  const actor = snapshotCoManagedSessionActor(inputActor);
  if (!isCoManagedUuid(packageId)) throw new CoManagedSharedWorkError();
  return withCoManagedExportAdmin(trx, actor, async (current, verified) => {
    for (const resource of ['interaction', 'user_schedule']) {
      if (!await hasCoManagedLocalPermission(current, verified, resource, 'read', true)) throw new CoManagedSharedWorkError();
    }
    const own = tenantDb(current, verified.tenant), columns = CO_MANAGED_PORTABLE_MEETING_COLUMNS.online_meetings;
    const rows = await own.table('online_meetings').select(...columns).orderBy('meeting_id').limit(LIMIT + 1).forShare();
    if (rows.length > LIMIT) throw new Error('Invalid portable meeting record count');
    // The schema allows ad-hoc meetings with none of the three source links (all nullable, no check
    // constraint). They have no exported parent to restore under, so they are named, not thrown on.
    const kept = rows.filter(row => row.interaction_id || row.appointment_request_id || row.schedule_entry_id);
    const records = { online_meetings: kept } as PortableRecords;
    validateCoManagedPortableMeetingRecords(records);
    return { records: JSON.parse(JSON.stringify(records)) as PortableRecords, tenant: verified.tenant, unlinked: rows.length - kept.length };
  });
}

const exclusions = (attendance: 'included' | 'unavailable', unlinked = 0) => [
  ...(unlinked ? [{ class: 'deferred_domain', name: 'online_meetings_without_source', reason: `${unlinked} ad-hoc meeting(s) linked to no appointment request, interaction or schedule entry are not exported.` }] : []),
  { class: 'secret', name: 'online_meeting_provider_identity', reason: 'Provider meeting/event ids and organizer identities are provider bindings and are not exported.' },
  { class: 'deferred_domain', name: 'online_meeting_recordings_and_transcripts', reason: 'Recordings and transcripts are not fetched from the provider; only tenant-stored files travel, via the artifacts section.' },
  ...(attendance === 'unavailable' ? [{ class: 'deferred_domain', name: 'online_meeting_attendance', reason: 'No attendance reader is configured; attendance is not exported.' }] : []),
];

// LEVERAGE: pattern portable-contributor-boilerplate — repeats the admission wrapper, permission check, tenantDb handle and JSON round-trip of the core/work/assets contributors.
/** `resolveAttendance` is the only provider seam. Attendance is not a table, so
 * it rides in the section annotations (not digested), which keeps `retain`
 * deterministic without a provider call inside a transaction. */
export function createPortableRemoteMeetingContributor(options: { resolveAttendance?: PortableMeetingAttendanceResolver } = {}): PortableContributor {
  return {
    id: 'meetings', version: 1, reason: 'customer-owned online meeting metadata, join links and attendance',
    columns: CO_MANAGED_PORTABLE_MEETING_COLUMNS, references: CO_MANAGED_PORTABLE_MEETING_REFERENCES,
    export: async ctx => {
      if (ctx.db.isTransaction) throw new Error('Portable export requires a root database connection');
      const actor = snapshotCoManagedSessionActor(ctx.actor);
      if (!isCoManagedUuid(ctx.packageId)) throw new CoManagedSharedWorkError();
      // LEVERAGE: pattern portable-export-is-snapshot-retain — export is the retain run at the shared snapshot.
      const { records, tenant, unlinked } = await portableSnapshotTransaction(ctx.db, ctx.snapshot, trx => retain(trx, actor, ctx.packageId));
      if (!options.resolveAttendance) return { records, annotations: { exclusions: exclusions('unavailable', unlinked) } };
      const meetings = records.online_meetings.map(row => ({ meeting_id: String(row.meeting_id), provider: String(row.provider) }));
      const known = new Set(meetings.map(row => row.meeting_id));
      const attendance = (await options.resolveAttendance(tenant, meetings)).map(row => {
        if (!known.has(row.meeting_id) || Object.keys(row).length !== ATTENDANCE_KEYS.length || !ATTENDANCE_KEYS.every(key => Object.hasOwn(row, key))) throw new Error('Invalid portable meeting attendance');
        return Object.fromEntries(ATTENDANCE_KEYS.map(key => [key, row[key]]));
      });
      if (attendance.length > LIMIT) throw new Error('Invalid portable meeting attendance count');
      return { records, annotations: { exclusions: exclusions('included', unlinked), attendance } };
    },
    retain: async ctx => {
      const { records } = await retain(ctx.trx, ctx.actor, ctx.packageId);
      return { records };
    },
    validate: records => validateCoManagedPortableMeetingRecords(records),
  };
}

export const portableRemoteMeetingContributor: PortableContributor = createPortableRemoteMeetingContributor();
