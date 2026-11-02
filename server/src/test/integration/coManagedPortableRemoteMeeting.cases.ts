/** CM L7b3 meeting export. STUBBED PROVIDER: Microsoft Graph is not reachable from this environment and the Teams
 * package has no attendance reader, so attendance comes from an injected stub resolver. The attendance assertions
 * below are therefore NOT a real provider pass; only the database-backed metadata assertions are real. */
import { describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createPortableRemoteMeetingContributor, portableRemoteMeetingContributor, type PortableMeetingAttendanceResolver }
  from '../../../../ee/server/src/lib/co-managed/portableRemoteMeetingExport';
import { exclusionNames, exportContributor, retainContributor, type PortableWorld } from './helpers/coManagedPortableExportFixture';

export function defineRemoteMeetingCases(get: () => { db: Knex; world: PortableWorld }) {
  describe('portable remote meeting export (attendance is STUBBED, not a real provider pass)', () => {
    const seed = async () => {
      const { db, world } = get();
      const scheduleId = uuidv4(), meetingId = uuidv4();
      await db('schedule_entries').insert({ tenant: world.customer, entry_id: scheduleId, title: 'Review', status: 'scheduled', work_item_type: 'ad_hoc',
        scheduled_start: new Date('2026-01-06T09:00:00Z'), scheduled_end: new Date('2026-01-06T10:00:00Z') });
      await db('online_meetings').insert({ tenant: world.customer, meeting_id: meetingId, provider: 'teams', provider_meeting_id: `PROVIDER-SECRET-ID-${meetingId}`,
        organizer_upn: 'organizer@example.com', subject: 'Quarterly review', join_url: 'https://teams.example.com/join/abc', status: 'scheduled',
        start_time: new Date('2026-01-06T09:00:00Z'), end_time: new Date('2026-01-06T10:00:00Z'), schedule_entry_id: scheduleId });
      return meetingId;
    };

    it('exports metadata and join links but no provider identity, with attendance excluded by name when no reader exists', async () => {
      const { db, world } = get();
      const meetingId = await seed();
      const { records, annotations } = await exportContributor(db, world, portableRemoteMeetingContributor);
      const row = records.online_meetings.find(meeting => meeting.meeting_id === meetingId)!;
      expect(row.join_url).toBe('https://teams.example.com/join/abc');
      expect(JSON.stringify(records)).not.toMatch(/PROVIDER-SECRET-ID-|organizer@example\.com/);
      expect(exclusionNames(annotations)).toEqual(expect.arrayContaining(['online_meeting_attendance', 'online_meeting_recordings_and_transcripts']));
      expect(annotations.attendance).toBeUndefined();
    });
    it('STUB: carries injected attendance in annotations, outside the digested records, and retain still matches', async () => {
      const { db, world } = get();
      const meetingId = await seed();
      const resolveAttendance: PortableMeetingAttendanceResolver = async (_tenant, meetings) => meetings.filter(m => m.meeting_id === meetingId).map(m => ({
        meeting_id: m.meeting_id, attendee_email: 'a@example.com', attendee_name: 'A', role: 'attendee', total_attendance_seconds: 1800,
        first_joined_at: '2026-01-06T09:01:00.000Z', last_left_at: '2026-01-06T09:31:00.000Z' }));
      const contributor = createPortableRemoteMeetingContributor({ resolveAttendance });
      const exported = await exportContributor(db, world, contributor);
      expect(exported.annotations.attendance).toEqual([expect.objectContaining({ meeting_id: meetingId, total_attendance_seconds: 1800 })]);
      expect(exclusionNames(exported.annotations)).not.toContain('online_meeting_attendance');
      expect(JSON.stringify((await retainContributor(db, world, contributor)).records)).toBe(JSON.stringify(exported.records));
    });
    it('rejects an attendance row for a meeting that was not exported', async () => {
      const { db, world } = get();
      await seed();
      const contributor = createPortableRemoteMeetingContributor({ resolveAttendance: async () => [{ meeting_id: uuidv4(), attendee_email: null,
        attendee_name: null, role: null, total_attendance_seconds: null, first_joined_at: null, last_left_at: null }] });
      await expect(exportContributor(db, world, contributor)).rejects.toThrow('Invalid portable meeting attendance');
    });

    it('an ad-hoc meeting linked to no appointment, interaction or schedule entry is named, not exported, and does not abort the export', async () => {
      const { db, world } = get();
      const meetingId = uuidv4();
      await db('online_meetings').insert({ tenant: world.customer, meeting_id: meetingId, provider: 'teams', provider_meeting_id: `ADHOC-${meetingId}`, subject: 'Ad hoc',
        status: 'scheduled', start_time: new Date('2026-01-07T09:00:00Z'), end_time: new Date('2026-01-07T10:00:00Z') });
      try {
        const { records, annotations } = await exportContributor(db, world, portableRemoteMeetingContributor);
        expect(records.online_meetings.map(row => row.meeting_id)).not.toContain(meetingId);
        expect(exclusionNames(annotations)).toContain('online_meetings_without_source');
        const retained = await retainContributor(db, world, portableRemoteMeetingContributor);
        expect(retained.records).toEqual(records);
      } finally { await db('online_meetings').where({ tenant: world.customer, meeting_id: meetingId }).delete(); }
    });
  });
}
