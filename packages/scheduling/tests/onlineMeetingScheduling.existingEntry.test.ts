import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IEditScope } from '@alga-psa/types';

const hasPermissionMock = vi.hoisted(() => vi.fn());
const publishEventMock = vi.hoisted(() => vi.fn());
const scheduleEntryGetMock = vi.hoisted(() => vi.fn());
const scheduleEntryUpdateMock = vi.hoisted(() => vi.fn());
const getRecurringEntriesInRangeMock = vi.hoisted(() => vi.fn());
const parseRecurrencePatternMock = vi.hoisted(() => vi.fn());
const createTeamsMeetingMock = vi.hoisted(() => vi.fn());
const deleteTeamsMeetingMock = vi.hoisted(() => vi.fn());
const getTeamsMeetingCapabilityMock = vi.hoisted(() => vi.fn());

const authState = vi.hoisted(() => ({
  currentUser: {
    user_id: 'user-1',
    tenant: 'tenant-1',
    email: 'creator@example.com',
    first_name: 'Cree',
    last_name: 'Ator',
  },
}));

/**
 * Minimal query-builder double: chainable filters (including forUpdate row
 * locks), with per-table result queues and write recording so the tests can
 * assert what the action persisted. `first()` results shift off per-table
 * queues in call order, which lets a single test script both the pre-check
 * and the locked in-transaction re-check.
 */
const dbState = vi.hoisted(() => ({
  // Queue of results for online_meetings .first() calls (pre-check, in-transaction re-check).
  onlineMeetingFirst: [] as unknown[],
  // Queue of results for schedule_entries .first() calls (the forUpdate lock reads).
  scheduleEntryFirst: [] as unknown[],
  // Queue of errors thrown by online_meetings .insert(); null/undefined means the insert succeeds.
  onlineMeetingInsertErrors: [] as unknown[],
  insertedMeetings: [] as Record<string, unknown>[],
  entryUpdates: [] as Record<string, unknown>[],
  userRows: [] as Record<string, unknown>[],
  reset() {
    this.onlineMeetingFirst = [];
    this.scheduleEntryFirst = [];
    this.onlineMeetingInsertErrors = [];
    this.insertedMeetings = [];
    this.entryUpdates = [];
    this.userRows = [];
  },
}));

vi.mock('@alga-psa/db', () => {
  const makeBuilder = (tableName: string) => {
    const builder: any = {
      where: () => builder,
      whereNot: () => builder,
      whereNull: () => builder,
      whereIn: () => builder,
      orderBy: () => builder,
      forUpdate: () => builder,
      first: async () => {
        if (tableName === 'online_meetings') return dbState.onlineMeetingFirst.shift();
        if (tableName === 'schedule_entries') return dbState.scheduleEntryFirst.shift();
        return undefined;
      },
      select: async () => (tableName === 'users' ? dbState.userRows : []),
      insert: async (row: Record<string, unknown>) => {
        if (tableName === 'online_meetings') {
          const error = dbState.onlineMeetingInsertErrors.shift();
          if (error) throw error;
          dbState.insertedMeetings.push(row);
        }
      },
      update: async (values: Record<string, unknown>) => {
        if (tableName === 'schedule_entries') dbState.entryUpdates.push(values);
      },
    };
    return builder;
  };

  return {
    createTenantKnex: async () => ({ knex: {}, tenant: authState.currentUser.tenant }),
    tenantDb: () => ({ table: makeBuilder }),
    withTransaction: async (_knex: unknown, fn: (trx: unknown) => Promise<unknown>) => fn({}),
  };
});

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: unknown[]) =>
    action(authState.currentUser, { tenant: authState.currentUser.tenant }, ...args),
  hasPermission: hasPermissionMock,
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: publishEventMock,
}));

vi.mock('@alga-psa/shared/models/scheduleEntry', () => ({
  default: {
    get: scheduleEntryGetMock,
    update: scheduleEntryUpdateMock,
    getRecurringEntriesInRange: getRecurringEntriesInRangeMock,
    parseRecurrencePattern: parseRecurrencePatternMock,
  },
}));

vi.mock('../src/lib/teamsMeetingService', () => ({
  resolveTeamsMeetingService: async () => ({
    getTeamsMeetingCapability: getTeamsMeetingCapabilityMock,
    createTeamsMeeting: createTeamsMeetingMock,
    deleteTeamsMeeting: deleteTeamsMeetingMock,
  }),
}));

const CONCRETE_ENTRY = {
  entry_id: 'entry-1',
  title: 'Kickoff call',
  notes: 'Agenda: everything',
  scheduled_start: '2026-09-04T15:00:00.000Z',
  scheduled_end: '2026-09-04T16:00:00.000Z',
  is_recurring: false,
  assigned_user_ids: ['user-2'],
};

const OCCURRENCE_START = '2026-09-11T15:00:00.000Z';
const OCCURRENCE_END = '2026-09-11T16:00:00.000Z';
const VIRTUAL_OCCURRENCE_ID = `master-1_${Date.parse(OCCURRENCE_START)}`;

/** What the recurrence engine generates for the virtual occurrence id above. */
const GENERATED_OCCURRENCE = {
  entry_id: VIRTUAL_OCCURRENCE_ID,
  title: 'Weekly sync',
  notes: 'Series agenda',
  scheduled_start: OCCURRENCE_START,
  scheduled_end: OCCURRENCE_END,
  is_recurring: true,
  assigned_user_ids: ['user-2'],
};

const CREATED_MEETING = {
  joinWebUrl: 'https://teams.microsoft.com/l/meetup-join/abc',
  meetingId: 'graph-meeting-1',
  organizerUpn: 'organizer@example.com',
  organizerUserId: 'organizer-object-id',
  eventId: 'graph-event-1',
};

/** A 23505 as pg raises it against the partial unique index (Citus shard-local name). */
function uniqueIndexViolation(): Error {
  return Object.assign(
    new Error('duplicate key value violates unique constraint "online_meetings_schedule_entry_active_unique_102008"'),
    { code: '23505', constraint: 'online_meetings_schedule_entry_active_unique_102008' },
  );
}

async function importAction() {
  const mod = await import('../src/actions/onlineMeetingSchedulingActions');
  return mod.scheduleTeamsMeeting;
}

describe('scheduleTeamsMeeting existing-entry mode', () => {
  beforeEach(() => {
    hasPermissionMock.mockReset().mockResolvedValue(true);
    publishEventMock.mockReset();
    scheduleEntryGetMock.mockReset().mockResolvedValue({ ...CONCRETE_ENTRY });
    scheduleEntryUpdateMock.mockReset().mockResolvedValue(undefined);
    getRecurringEntriesInRangeMock.mockReset().mockResolvedValue([]);
    parseRecurrencePatternMock.mockReset().mockReturnValue(null);
    createTeamsMeetingMock.mockReset().mockResolvedValue({ ...CREATED_MEETING });
    deleteTeamsMeetingMock.mockReset().mockResolvedValue(true);
    getTeamsMeetingCapabilityMock.mockReset().mockResolvedValue({ available: true, recordingsAvailable: false });
    dbState.reset();
    dbState.userRows = [{ email: 'tech@example.com', first_name: 'Tech', last_name: 'One' }];
    // The concrete entry exists and its forUpdate lock read succeeds by default.
    dbState.scheduleEntryFirst = [{ entry_id: 'entry-1', recurrence_pattern: null }];
  });

  it('links the meeting to the entry transactionally, preserves the entry, and publishes no schedule event', async () => {
    const scheduleTeamsMeeting = await importAction();

    const result = await scheduleTeamsMeeting({ scheduleEntryId: 'entry-1' });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.schedule_entry_id).toBe('entry-1');
    expect(result.data.interaction_id).toBeNull();
    expect(result.data.join_url).toBe(CREATED_MEETING.joinWebUrl);
    expect(result.data.provider_meeting_id).toBe(CREATED_MEETING.meetingId);
    expect(result.data.schedule_entry_notes).toContain('Agenda: everything');
    expect(result.data.schedule_entry_notes).toContain(CREATED_MEETING.joinWebUrl);

    // The online_meetings row is linked to the entry, without an interaction.
    expect(dbState.insertedMeetings).toHaveLength(1);
    const inserted = dbState.insertedMeetings[0];
    expect(inserted.schedule_entry_id).toBe('entry-1');
    expect(inserted.interaction_id).toBeNull();
    expect(inserted.appointment_request_id).toBeNull();
    expect(inserted.subject).toBe('Kickoff call');
    expect(inserted.provider).toBe('teams');

    // The entry itself is preserved — only its notes gain the join link.
    expect(dbState.entryUpdates).toHaveLength(1);
    expect(String(dbState.entryUpdates[0].notes)).toContain(CREATED_MEETING.joinWebUrl);

    // No entry was created in this mode, so no SCHEDULE_ENTRY_CREATED event.
    expect(publishEventMock).not.toHaveBeenCalled();

    // The meeting subject/times come from the entry, and attendees include the
    // entry's assignee plus the creator.
    const graphInput = createTeamsMeetingMock.mock.calls[0][0];
    expect(graphInput.subject).toBe('Kickoff call');
    expect(graphInput.startDateTime).toBe(CONCRETE_ENTRY.scheduled_start);
    expect(graphInput.endDateTime).toBe(CONCRETE_ENTRY.scheduled_end);
    const attendeeEmails = graphInput.attendees.map((a: any) => a.emailAddress.address);
    expect(attendeeEmails).toContain('tech@example.com');
    expect(attendeeEmails).toContain('creator@example.com');
  });

  it('excludes assignees without an email instead of failing the meeting', async () => {
    dbState.userRows = [
      { email: null, first_name: 'No', last_name: 'Email' },
      { email: 'has@example.com', first_name: 'Has', last_name: 'Email' },
    ];
    const scheduleTeamsMeeting = await importAction();

    const result = await scheduleTeamsMeeting({ scheduleEntryId: 'entry-1' });

    expect(result.success).toBe(true);
    const attendeeEmails = createTeamsMeetingMock.mock.calls[0][0].attendees
      .map((a: any) => a.emailAddress.address);
    expect(attendeeEmails).toEqual(expect.arrayContaining(['has@example.com', 'creator@example.com']));
    expect(attendeeEmails).toHaveLength(2);
  });

  it('rejects an entry that already has a non-cancelled meeting before calling Graph', async () => {
    dbState.onlineMeetingFirst = [{ meeting_id: 'existing-meeting' }];
    const scheduleTeamsMeeting = await importAction();

    const result = await scheduleTeamsMeeting({ scheduleEntryId: 'entry-1' });

    expect(result).toEqual({ success: false, error: 'This schedule entry already has a Teams meeting.' });
    expect(createTeamsMeetingMock).not.toHaveBeenCalled();
    expect(dbState.insertedMeetings).toHaveLength(0);
  });

  it('re-checks for duplicates under the entry row lock and deletes the Graph meeting on loss', async () => {
    // Pre-check sees nothing; a concurrent create wins before the locked re-check.
    dbState.onlineMeetingFirst = [undefined, { meeting_id: 'race-winner' }];
    const scheduleTeamsMeeting = await importAction();

    const result = await scheduleTeamsMeeting({ scheduleEntryId: 'entry-1' });

    expect(result).toEqual({ success: false, error: 'This schedule entry already has a Teams meeting.' });
    expect(dbState.insertedMeetings).toHaveLength(0);
    expect(deleteTeamsMeetingMock).toHaveBeenCalledWith(expect.objectContaining({
      meetingId: CREATED_MEETING.meetingId,
      eventId: CREATED_MEETING.eventId,
    }));
  });

  it('lets exactly one of two racing calls create the meeting; the loser hits the unique index and cleans up', async () => {
    // Both calls pass the pre-check and the locked re-check (the double cannot
    // block on a row lock), leaving the partial unique index as the backstop:
    // the first insert lands, the second raises 23505.
    dbState.onlineMeetingFirst = [undefined, undefined, undefined, undefined];
    dbState.scheduleEntryFirst = [
      { entry_id: 'entry-1', recurrence_pattern: null },
      { entry_id: 'entry-1', recurrence_pattern: null },
    ];
    dbState.onlineMeetingInsertErrors = [null, uniqueIndexViolation()];
    createTeamsMeetingMock
      .mockResolvedValueOnce({ ...CREATED_MEETING, meetingId: 'graph-meeting-a', eventId: 'graph-event-a' })
      .mockResolvedValueOnce({ ...CREATED_MEETING, meetingId: 'graph-meeting-b', eventId: 'graph-event-b' });
    const scheduleTeamsMeeting = await importAction();

    const results = await Promise.all([
      scheduleTeamsMeeting({ scheduleEntryId: 'entry-1' }),
      scheduleTeamsMeeting({ scheduleEntryId: 'entry-1' }),
    ]);

    const successes = results.filter((r) => r.success);
    const failures = results.filter((r) => !r.success);
    expect(successes).toHaveLength(1);
    expect(failures).toEqual([{ success: false, error: 'This schedule entry already has a Teams meeting.' }]);

    // Exactly one meeting row exists, linked to the entry.
    expect(dbState.insertedMeetings).toHaveLength(1);
    expect(dbState.insertedMeetings[0].schedule_entry_id).toBe('entry-1');

    // The loser's Graph meeting was deleted; the winner's was not.
    const winnerId = successes[0].success ? successes[0].data.provider_meeting_id : undefined;
    const loserId = winnerId === 'graph-meeting-a' ? 'graph-meeting-b' : 'graph-meeting-a';
    expect(deleteTeamsMeetingMock).toHaveBeenCalledTimes(1);
    expect(deleteTeamsMeetingMock).toHaveBeenCalledWith(expect.objectContaining({ meetingId: loserId }));
  });

  it('materializes a recurring occurrence and links the meeting to the standalone entry', async () => {
    getRecurringEntriesInRangeMock.mockResolvedValue([{ ...GENERATED_OCCURRENCE }]);
    dbState.scheduleEntryFirst = [{ entry_id: 'master-1', recurrence_pattern: '{"frequency":"weekly"}' }];
    parseRecurrencePatternMock.mockReturnValue({ frequency: 'weekly', exceptions: [] });
    scheduleEntryUpdateMock.mockResolvedValue({ entry_id: 'materialized-1' });
    const scheduleTeamsMeeting = await importAction();

    const result = await scheduleTeamsMeeting({ scheduleEntryId: VIRTUAL_OCCURRENCE_ID });

    expect(result.success).toBe(true);
    if (!result.success) return;
    // The meeting attaches to the materialized entry, not the virtual id.
    expect(result.data.schedule_entry_id).toBe('materialized-1');
    expect(result.data.interaction_id).toBeNull();
    expect(result.data.schedule_entry_notes).toContain('Series agenda');
    expect(result.data.schedule_entry_notes).toContain(CREATED_MEETING.joinWebUrl);

    // Materialization goes through the engine's SINGLE-scope extraction with
    // the occurrence's own times and the join link appended to its notes.
    expect(scheduleEntryUpdateMock).toHaveBeenCalledTimes(1);
    const [, tenant, entryId, updateData, editScope] = scheduleEntryUpdateMock.mock.calls[0];
    expect(tenant).toBe('tenant-1');
    expect(entryId).toBe(VIRTUAL_OCCURRENCE_ID);
    expect(updateData.scheduled_start).toEqual(new Date(OCCURRENCE_START));
    expect(updateData.scheduled_end).toEqual(new Date(OCCURRENCE_END));
    expect(String(updateData.notes)).toContain(CREATED_MEETING.joinWebUrl);
    expect(editScope).toBe(IEditScope.SINGLE);

    // The online_meetings row links to the materialized entry; nothing wrote
    // to the master directly and no schedule event was published.
    expect(dbState.insertedMeetings).toHaveLength(1);
    expect(dbState.insertedMeetings[0].schedule_entry_id).toBe('materialized-1');
    expect(dbState.insertedMeetings[0].subject).toBe('Weekly sync');
    expect(dbState.entryUpdates).toHaveLength(0);
    expect(publishEventMock).not.toHaveBeenCalled();

    // The Graph meeting uses the occurrence's subject and times.
    const graphInput = createTeamsMeetingMock.mock.calls[0][0];
    expect(graphInput.subject).toBe('Weekly sync');
    expect(graphInput.startDateTime).toBe(OCCURRENCE_START);
    expect(graphInput.endDateTime).toBe(OCCURRENCE_END);
  });

  it('rejects an occurrence id the recurrence engine no longer generates (extracted or deleted)', async () => {
    getRecurringEntriesInRangeMock.mockResolvedValue([]);
    const scheduleTeamsMeeting = await importAction();

    const result = await scheduleTeamsMeeting({ scheduleEntryId: VIRTUAL_OCCURRENCE_ID });

    expect(result).toEqual({
      success: false,
      error: 'This occurrence is no longer part of the recurring series. Refresh the calendar and try again.',
    });
    expect(scheduleEntryGetMock).not.toHaveBeenCalled();
    expect(createTeamsMeetingMock).not.toHaveBeenCalled();
    expect(dbState.insertedMeetings).toHaveLength(0);
  });

  it('rejects an occurrence extracted concurrently (excepted under the master lock) and deletes the Graph meeting', async () => {
    getRecurringEntriesInRangeMock.mockResolvedValue([{ ...GENERATED_OCCURRENCE }]);
    dbState.scheduleEntryFirst = [{ entry_id: 'master-1', recurrence_pattern: '{"frequency":"weekly"}' }];
    // By the time the master lock is held, another transaction has extracted
    // this occurrence: the master's pattern now carries its exception.
    parseRecurrencePatternMock.mockReturnValue({
      frequency: 'weekly',
      exceptions: [new Date('2026-09-11T08:00:00.000Z')],
    });
    const scheduleTeamsMeeting = await importAction();

    const result = await scheduleTeamsMeeting({ scheduleEntryId: VIRTUAL_OCCURRENCE_ID });

    expect(result).toEqual({
      success: false,
      error: 'This occurrence is no longer part of the recurring series. Refresh the calendar and try again.',
    });
    expect(scheduleEntryUpdateMock).not.toHaveBeenCalled();
    expect(dbState.insertedMeetings).toHaveLength(0);
    expect(deleteTeamsMeetingMock).toHaveBeenCalledWith(expect.objectContaining({
      meetingId: CREATED_MEETING.meetingId,
      eventId: CREATED_MEETING.eventId,
    }));
  });

  it('rejects recurring master entries', async () => {
    scheduleEntryGetMock.mockResolvedValue({ ...CONCRETE_ENTRY, is_recurring: true });
    const scheduleTeamsMeeting = await importAction();

    const result = await scheduleTeamsMeeting({ scheduleEntryId: 'entry-1' });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain('not a recurring series');
    expect(createTeamsMeetingMock).not.toHaveBeenCalled();
  });

  it('fails cleanly when the entry does not exist in the tenant', async () => {
    scheduleEntryGetMock.mockResolvedValue(undefined);
    const scheduleTeamsMeeting = await importAction();

    const result = await scheduleTeamsMeeting({ scheduleEntryId: 'entry-1' });

    expect(result).toEqual({ success: false, error: 'Schedule entry not found.' });
    expect(createTeamsMeetingMock).not.toHaveBeenCalled();
  });

  it('rejects combining scheduleEntryId with createScheduleEntry', async () => {
    const scheduleTeamsMeeting = await importAction();

    const result = await scheduleTeamsMeeting({ scheduleEntryId: 'entry-1', createScheduleEntry: true });

    expect(result).toEqual({
      success: false,
      error: 'scheduleEntryId cannot be combined with createScheduleEntry.',
    });
    expect(createTeamsMeetingMock).not.toHaveBeenCalled();
  });

  it('requires user_schedule update permission', async () => {
    hasPermissionMock.mockResolvedValue(false);
    const scheduleTeamsMeeting = await importAction();

    const result = await scheduleTeamsMeeting({ scheduleEntryId: 'entry-1' });

    expect(result).toEqual({ success: false, error: 'Permission denied to schedule Teams meetings.' });
    expect(scheduleEntryGetMock).not.toHaveBeenCalled();
  });

  it('surfaces the capability reason when Teams is not configured', async () => {
    getTeamsMeetingCapabilityMock.mockResolvedValue({ available: false, reason: 'not_configured' });
    const scheduleTeamsMeeting = await importAction();

    const result = await scheduleTeamsMeeting({ scheduleEntryId: 'entry-1' });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain('Teams is not configured');
    expect(createTeamsMeetingMock).not.toHaveBeenCalled();
  });
});
