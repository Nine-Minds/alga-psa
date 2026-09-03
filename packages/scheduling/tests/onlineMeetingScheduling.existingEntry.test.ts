import { beforeEach, describe, expect, it, vi } from 'vitest';

const hasPermissionMock = vi.hoisted(() => vi.fn());
const publishEventMock = vi.hoisted(() => vi.fn());
const scheduleEntryGetMock = vi.hoisted(() => vi.fn());
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
 * Minimal query-builder double: chainable filters, with per-table result and
 * write recording so the tests can assert what the action persisted.
 */
const dbState = vi.hoisted(() => ({
  // Queue of results for online_meetings .first() calls (pre-check, in-transaction re-check).
  onlineMeetingFirst: [] as unknown[],
  insertedMeetings: [] as Record<string, unknown>[],
  entryUpdates: [] as Record<string, unknown>[],
  userRows: [] as Record<string, unknown>[],
  reset() {
    this.onlineMeetingFirst = [];
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
      first: async () => (tableName === 'online_meetings' ? dbState.onlineMeetingFirst.shift() : undefined),
      select: async () => (tableName === 'users' ? dbState.userRows : []),
      insert: async (row: Record<string, unknown>) => {
        if (tableName === 'online_meetings') dbState.insertedMeetings.push(row);
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
  default: { get: scheduleEntryGetMock },
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

const CREATED_MEETING = {
  joinWebUrl: 'https://teams.microsoft.com/l/meetup-join/abc',
  meetingId: 'graph-meeting-1',
  organizerUpn: 'organizer@example.com',
  organizerUserId: 'organizer-object-id',
  eventId: 'graph-event-1',
};

async function importAction() {
  const mod = await import('../src/actions/onlineMeetingSchedulingActions');
  return mod.scheduleTeamsMeeting;
}

describe('scheduleTeamsMeeting existing-entry mode', () => {
  beforeEach(() => {
    hasPermissionMock.mockReset().mockResolvedValue(true);
    publishEventMock.mockReset();
    scheduleEntryGetMock.mockReset().mockResolvedValue({ ...CONCRETE_ENTRY });
    createTeamsMeetingMock.mockReset().mockResolvedValue({ ...CREATED_MEETING });
    deleteTeamsMeetingMock.mockReset().mockResolvedValue(true);
    getTeamsMeetingCapabilityMock.mockReset().mockResolvedValue({ available: true, recordingsAvailable: false });
    dbState.reset();
    dbState.userRows = [{ email: 'tech@example.com', first_name: 'Tech', last_name: 'One' }];
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

  it('rejects an entry that already has a non-cancelled meeting before calling Graph', async () => {
    dbState.onlineMeetingFirst = [{ meeting_id: 'existing-meeting' }];
    const scheduleTeamsMeeting = await importAction();

    const result = await scheduleTeamsMeeting({ scheduleEntryId: 'entry-1' });

    expect(result).toEqual({ success: false, error: 'This schedule entry already has a Teams meeting.' });
    expect(createTeamsMeetingMock).not.toHaveBeenCalled();
    expect(dbState.insertedMeetings).toHaveLength(0);
  });

  it('re-checks for duplicates inside the transaction and deletes the Graph meeting on loss', async () => {
    // Pre-check sees nothing; a concurrent create wins before the transaction re-check.
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

  it('rejects virtual occurrence ids of recurring series', async () => {
    const scheduleTeamsMeeting = await importAction();

    const result = await scheduleTeamsMeeting({ scheduleEntryId: 'master-id_1757000000000' });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain('not a recurring occurrence');
    expect(scheduleEntryGetMock).not.toHaveBeenCalled();
    expect(createTeamsMeetingMock).not.toHaveBeenCalled();
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
