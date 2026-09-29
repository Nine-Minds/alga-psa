import { beforeEach, describe, expect, it, vi } from 'vitest';

const publishEventMock = vi.hoisted(() => vi.fn());
const publishWorkflowEventMock = vi.hoisted(() => vi.fn());
const scheduleEntryGetMock = vi.hoisted(() => vi.fn());
const scheduleEntryDeleteMock = vi.hoisted(() => vi.fn());
const deleteEntityWithValidationMock = vi.hoisted(() => vi.fn());
const deleteTeamsMeetingMock = vi.hoisted(() => vi.fn());
const maybePublishCapacityThresholdReachedMock = vi.hoisted(() => vi.fn());

const authState = vi.hoisted(() => ({
  currentUser: {
    user_id: 'user-1',
    tenant: 'tenant-1',
    email: 'creator@example.com',
  },
}));

/**
 * Minimal query-builder double for the entry-deletion path: chainable filters,
 * queued online_meetings select results, and recording of which meeting rows
 * the sweep cancels so the tests can distinguish "locally cancelled" from
 * "externally retracted".
 */
const dbState = vi.hoisted(() => ({
  // Rows returned by online_meetings .select() (the retraction sweep's fetch).
  onlineMeetingRows: [] as Record<string, unknown>[],
  // meeting_ids the sweep passed to whereIn() before .update({status:'cancelled'}).
  cancelledMeetingIds: [] as unknown[],
  cancelUpdates: [] as Record<string, unknown>[],
  reset() {
    this.onlineMeetingRows = [];
    this.cancelledMeetingIds = [];
    this.cancelUpdates = [];
  },
}));

vi.mock('@alga-psa/db', () => {
  const makeBuilder = (tableName: string) => {
    let whereInIds: unknown[] = [];
    const builder: any = {
      where: () => builder,
      whereNot: () => builder,
      whereNull: () => builder,
      whereIn: (_column: string, ids: unknown[]) => {
        whereInIds = ids;
        return builder;
      },
      orderBy: () => builder,
      first: async () => undefined,
      del: async () => 0,
      select: async () => (tableName === 'online_meetings' ? dbState.onlineMeetingRows : []),
      update: async (values: Record<string, unknown>) => {
        if (tableName === 'online_meetings') {
          dbState.cancelledMeetingIds.push(...whereInIds);
          dbState.cancelUpdates.push(values);
        }
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
  hasPermission: vi.fn().mockResolvedValue(true),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: publishEventMock,
  publishWorkflowEvent: publishWorkflowEventMock,
}));

vi.mock('@alga-psa/shared/models/scheduleEntry', () => ({
  default: {
    get: scheduleEntryGetMock,
    delete: scheduleEntryDeleteMock,
  },
}));

vi.mock('@alga-psa/core/server', () => ({
  deleteEntityWithValidation: deleteEntityWithValidationMock,
}));

vi.mock('../src/lib/teamsMeetingService', () => ({
  resolveTeamsMeetingService: async () => ({
    deleteTeamsMeeting: deleteTeamsMeetingMock,
  }),
}));

vi.mock('../src/lib/capacityThresholdWorkflowEvents', () => ({
  maybePublishCapacityThresholdReached: maybePublishCapacityThresholdReachedMock,
}));

vi.mock('../src/lib/teamsMeetingContent', () => ({
  resolveAppointmentTeamsMeetingContext: vi.fn(),
}));

vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  actionError: (message: string) => new Error(message),
  permissionError: (message: string) => new Error(message),
}));

vi.mock('@alga-psa/workflow-streams', () => ({
  buildAppointmentAssignedPayload: () => ({}),
  buildAppointmentCanceledPayload: () => ({}),
  buildAppointmentCompletedPayload: () => ({}),
  buildAppointmentCreatedPayload: () => ({}),
  buildAppointmentNoShowPayload: () => ({}),
  buildAppointmentRescheduledPayload: () => ({}),
  getSingleUserAssigneeId: () => undefined,
  getTicketIdFromScheduleEntry: () => undefined,
  isAppointmentCanceledStatus: () => false,
  isAppointmentCompletedStatus: () => false,
  isAppointmentNoShowStatus: () => false,
  isAppointmentRescheduled: () => false,
  shouldEmitAppointmentEvents: () => false,
  buildScheduleBlockCreatedPayload: () => ({}),
  buildScheduleBlockDeletedPayload: () => ({}),
  isScheduleBlockEntry: () => false,
  buildTechnicianArrivedPayload: () => ({}),
  buildTechnicianCheckedOutPayload: () => ({}),
  buildTechnicianDispatchedPayload: () => ({}),
  buildTechnicianEnRoutePayload: () => ({}),
  getTechnicianUserIds: () => [],
  isTechnicianArrivedStatus: () => false,
  isTechnicianCheckedOutStatus: () => false,
  isTechnicianEnRouteStatus: () => false,
  shouldEmitTechnicianDispatchEvents: () => false,
}));

const EXISTING_ENTRY = {
  entry_id: 'entry-1',
  title: 'Kickoff call',
  scheduled_start: '2026-09-04T15:00:00.000Z',
  scheduled_end: '2026-09-04T16:00:00.000Z',
  is_private: false,
  is_recurring: false,
  work_item_type: null,
  work_item_id: null,
  assigned_user_ids: ['user-2'],
  status: 'scheduled',
};

async function importAction() {
  const mod = await import('../src/actions/scheduleActions');
  return mod.deleteScheduleEntry;
}

describe('deleteScheduleEntry Teams meeting retraction sweep', () => {
  beforeEach(() => {
    publishEventMock.mockReset();
    publishWorkflowEventMock.mockReset();
    scheduleEntryGetMock.mockReset().mockResolvedValue({ ...EXISTING_ENTRY });
    scheduleEntryDeleteMock.mockReset().mockResolvedValue(true);
    deleteEntityWithValidationMock.mockReset().mockImplementation(
      async (
        _entityType: string,
        _entityId: string,
        _knex: unknown,
        tenant: string,
        performDelete: (trx: unknown, tenant: string) => Promise<void>,
      ) => {
        await performDelete({}, tenant);
        return { canDelete: true, dependencies: [], alternatives: [], deleted: true };
      },
    );
    deleteTeamsMeetingMock.mockReset().mockResolvedValue(true);
    maybePublishCapacityThresholdReachedMock.mockReset().mockResolvedValue(undefined);
    dbState.reset();
  });

  it('retracts locally-cancelled rows too, but only re-cancels active rows', async () => {
    // One live meeting plus one row a migration (or a failed best-effort
    // delete) left cancelled locally while its Graph meeting stayed live.
    dbState.onlineMeetingRows = [
      {
        meeting_id: 'm-active',
        provider: 'teams',
        provider_meeting_id: 'graph-active',
        provider_event_id: 'event-active',
        status: 'scheduled',
      },
      {
        meeting_id: 'm-collapsed',
        provider: 'teams',
        provider_meeting_id: 'graph-collapsed',
        provider_event_id: 'event-collapsed',
        status: 'cancelled',
      },
    ];
    const deleteScheduleEntry = await importAction();

    const result = await deleteScheduleEntry('entry-1');

    expect(result.success).toBe(true);
    expect(result.deleted).toBe(true);

    // Both external meetings are retracted — including the one whose row was
    // already cancelled locally without a Graph retraction.
    expect(deleteTeamsMeetingMock).toHaveBeenCalledTimes(2);
    expect(deleteTeamsMeetingMock).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      meetingId: 'graph-active',
      eventId: 'event-active',
    }));
    expect(deleteTeamsMeetingMock).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      meetingId: 'graph-collapsed',
      eventId: 'event-collapsed',
    }));

    // Only the active row is (re)marked cancelled; the collapsed row keeps its
    // existing status untouched.
    expect(dbState.cancelledMeetingIds).toEqual(['m-active']);
    expect(dbState.cancelUpdates).toHaveLength(1);
    expect(dbState.cancelUpdates[0].status).toBe('cancelled');
  });

  it('skips non-teams rows and rows without a provider meeting id', async () => {
    dbState.onlineMeetingRows = [
      {
        meeting_id: 'm-zoom',
        provider: 'zoom',
        provider_meeting_id: 'zoom-1',
        provider_event_id: null,
        status: 'scheduled',
      },
      {
        meeting_id: 'm-unlinked',
        provider: 'teams',
        provider_meeting_id: null,
        provider_event_id: null,
        status: 'cancelled',
      },
    ];
    const deleteScheduleEntry = await importAction();

    const result = await deleteScheduleEntry('entry-1');

    expect(result.success).toBe(true);
    expect(deleteTeamsMeetingMock).not.toHaveBeenCalled();
    // The active zoom row is still cancelled locally.
    expect(dbState.cancelledMeetingIds).toEqual(['m-zoom']);
  });

  it('still deletes the entry when Graph retraction reports failure', async () => {
    // deleteTeamsMeeting never throws (the EE service maps Graph 404 to
    // success and catches everything else); a false return means the external
    // delete failed, which must not fail the entry deletion.
    deleteTeamsMeetingMock.mockResolvedValue(false);
    dbState.onlineMeetingRows = [
      {
        meeting_id: 'm-active',
        provider: 'teams',
        provider_meeting_id: 'graph-active',
        provider_event_id: 'event-active',
        status: 'scheduled',
      },
    ];
    const deleteScheduleEntry = await importAction();

    const result = await deleteScheduleEntry('entry-1');

    expect(result.success).toBe(true);
    expect(result.deleted).toBe(true);
    expect(deleteTeamsMeetingMock).toHaveBeenCalledTimes(1);
    expect(dbState.cancelledMeetingIds).toEqual(['m-active']);
  });

  it('does not resolve the Teams service when the entry has no linked meetings', async () => {
    dbState.onlineMeetingRows = [];
    const deleteScheduleEntry = await importAction();

    const result = await deleteScheduleEntry('entry-1');

    expect(result.success).toBe(true);
    expect(deleteTeamsMeetingMock).not.toHaveBeenCalled();
    expect(dbState.cancelledMeetingIds).toEqual([]);
  });
});
