import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  hasPermissionMock: vi.fn(),
  createInteractionWithSideEffectsMock: vi.fn(),
  insertMock: vi.fn(),
  scheduleEntryCreateMock: vi.fn(),
  createTeamsMeetingMock: vi.fn(),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: any[]) =>
    action({ user_id: 'user-1', user_type: 'internal', email: 'creator@example.com' }, { tenant: 'tenant-1' }, ...args),
  hasPermission: hoisted.hasPermissionMock,
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {} as any }),
  withTransaction: async (_db: any, fn: any) => fn({} as any),
  tenantDb: () => ({
    table: (name: string) =>
      name === 'system_interaction_types'
        ? { where: () => ({ first: async () => ({ type_id: 'online-meeting-type' }) }) }
        : { insert: hoisted.insertMock },
  }),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({ publishEvent: vi.fn() }));

vi.mock('@alga-psa/shared/models/scheduleEntry', () => ({
  default: { create: hoisted.scheduleEntryCreateMock },
}));

vi.mock('../src/lib/teamsMeetingService', () => ({
  resolveTeamsMeetingService: async () => ({
    getTeamsMeetingCapability: async () => ({ available: true }),
    createTeamsMeeting: hoisted.createTeamsMeetingMock,
    deleteTeamsMeeting: vi.fn(),
  }),
}));

vi.mock('../src/lib/teamsMeetingContent', () => ({
  ensureCreatorAttendee: (attendees: any[]) => attendees,
}));

vi.mock('@alga-psa/clients/actions/interactionCreateHelper', () => ({
  createInteractionWithSideEffects: hoisted.createInteractionWithSideEffectsMock,
}));

function meetingInput(overrides: Record<string, unknown> = {}) {
  return {
    subject: 'Quarterly review',
    startDateTime: new Date('2026-09-10T15:00:00Z'),
    endDateTime: new Date('2026-09-10T15:30:00Z'),
    client_id: 'client-1',
    ...overrides,
  } as any;
}

describe('scheduleTeamsMeeting interaction owner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.hasPermissionMock.mockResolvedValue(true);
    hoisted.createTeamsMeetingMock.mockResolvedValue({
      meetingId: 'teams-meeting-1',
      eventId: 'teams-event-1',
      joinWebUrl: 'https://teams.example.com/join',
      organizerUpn: 'organizer@example.com',
      organizerUserId: 'organizer-1',
    });
    hoisted.insertMock.mockResolvedValue(undefined);
    hoisted.scheduleEntryCreateMock.mockResolvedValue({ entry_id: 'schedule-entry-1' });
    hoisted.createInteractionWithSideEffectsMock.mockResolvedValue({
      interaction: { interaction_id: 'interaction-1' },
      publishSideEffects: vi.fn(),
    });
  });

  it('logs the meeting against the chosen owner', async () => {
    const { scheduleTeamsMeeting } = await import('../src/actions/onlineMeetingSchedulingActions');
    const result = await scheduleTeamsMeeting(meetingInput({ interactionUserId: 'user-2' }));

    expect(result).toMatchObject({ success: true });
    expect(hoisted.createInteractionWithSideEffectsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        interactionData: expect.objectContaining({ user_id: 'user-2' }),
      }),
    );
  });

  it('falls back to the creator when no owner is chosen', async () => {
    const { scheduleTeamsMeeting } = await import('../src/actions/onlineMeetingSchedulingActions');
    const result = await scheduleTeamsMeeting(meetingInput());

    expect(result).toMatchObject({ success: true });
    expect(hoisted.createInteractionWithSideEffectsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        interactionData: expect.objectContaining({ user_id: 'user-1' }),
      }),
    );
  });

  it('books the requested AlgaPSA calendars alongside the chosen owner', async () => {
    const { scheduleTeamsMeeting } = await import('../src/actions/onlineMeetingSchedulingActions');
    await scheduleTeamsMeeting(meetingInput({
      interactionUserId: 'user-2',
      createScheduleEntry: true,
      scheduleEntry: { assignedUserIds: ['user-2', 'user-3'] },
    }));

    expect(hoisted.scheduleEntryCreateMock).toHaveBeenCalledWith(
      expect.anything(),
      'tenant-1',
      expect.objectContaining({ assigned_user_ids: ['user-2', 'user-3'] }),
      expect.objectContaining({ assignedUserIds: ['user-2', 'user-3'], assignedByUserId: 'user-1' }),
    );
  });

  it('creates no local records when the Teams provider cannot create the meeting', async () => {
    hoisted.createTeamsMeetingMock.mockResolvedValue(null);
    const { scheduleTeamsMeeting } = await import('../src/actions/onlineMeetingSchedulingActions');

    const result = await scheduleTeamsMeeting(meetingInput({
      createScheduleEntry: true,
      scheduleEntry: { assignedUserIds: ['user-2', 'user-3'] },
    }));

    expect(result).toEqual({
      success: false,
      error: 'Microsoft Teams meeting could not be created. Please try again or create it manually in Teams.',
    });
    expect(hoisted.createTeamsMeetingMock).toHaveBeenCalledOnce();
    expect(hoisted.createInteractionWithSideEffectsMock).not.toHaveBeenCalled();
    expect(hoisted.scheduleEntryCreateMock).not.toHaveBeenCalled();
    expect(hoisted.insertMock).not.toHaveBeenCalled();
  });

  it('rejects calendar assignment before contacting Teams when schedule permission is missing', async () => {
    hoisted.hasPermissionMock.mockResolvedValue(false);
    const { scheduleTeamsMeeting } = await import('../src/actions/onlineMeetingSchedulingActions');

    const result = await scheduleTeamsMeeting(meetingInput({
      createScheduleEntry: true,
      scheduleEntry: { assignedUserIds: ['user-2', 'user-3'] },
    }));

    expect(result).toEqual({ success: false, error: 'Permission denied to schedule Teams meetings.' });
    expect(hoisted.hasPermissionMock).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-1' }), 'user_schedule', 'update', expect.anything(),
    );
    expect(hoisted.createTeamsMeetingMock).not.toHaveBeenCalled();
    expect(hoisted.createInteractionWithSideEffectsMock).not.toHaveBeenCalled();
    expect(hoisted.scheduleEntryCreateMock).not.toHaveBeenCalled();
    expect(hoisted.insertMock).not.toHaveBeenCalled();
  });
});
