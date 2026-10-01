import { beforeEach, describe, expect, it, vi } from 'vitest';

const publishEventMock = vi.hoisted(() => vi.fn());
const publishWorkflowEventMock = vi.hoisted(() => vi.fn());
const scheduleEntryGetMock = vi.hoisted(() => vi.fn());
const scheduleEntryUpdateMock = vi.hoisted(() => vi.fn());
const hasPermissionMock = vi.hoisted(() => vi.fn());
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

vi.mock('@alga-psa/db', () => {
  const builder: any = {
    where: () => builder,
    whereNull: () => builder,
    del: vi.fn().mockResolvedValue(0),
    select: vi.fn().mockResolvedValue([]),
  };
  return {
    createTenantKnex: async () => ({ knex: {}, tenant: 'tenant-1' }),
    tenantDb: () => ({ table: () => builder }),
    withTransaction: async (_db: unknown, fn: (trx: unknown) => Promise<unknown>) => fn({}),
  };
});

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: unknown[]) =>
    action(authState.currentUser, { tenant: authState.currentUser.tenant }, ...args),
  hasPermission: hasPermissionMock,
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: publishEventMock,
  publishWorkflowEvent: publishWorkflowEventMock,
}));

vi.mock('@alga-psa/shared/models/scheduleEntry', () => ({
  default: {
    get: scheduleEntryGetMock,
    delete: scheduleEntryDeleteMock,
    update: scheduleEntryUpdateMock,
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

describe('schedule entry mutation permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasPermissionMock.mockResolvedValue(true);
    scheduleEntryGetMock.mockResolvedValue({ ...EXISTING_ENTRY });
    scheduleEntryUpdateMock.mockImplementation(async (_trx, _tenant, _id, patch) => ({ ...EXISTING_ENTRY, ...patch }));
    scheduleEntryDeleteMock.mockResolvedValue(true);
    deleteEntityWithValidationMock.mockImplementation(async (_type, _id, _db, tenant, performDelete) => {
      await performDelete({}, tenant);
      return { deleted: true, canDelete: true, dependencies: [], alternatives: [] };
    });
  });

  it.each([undefined, ['user-1']])('denies own-entry update without update permission (assignment %j)', async (assigned_user_ids) => {
    const { updateScheduleEntry } = await import('../src/actions/scheduleActions');
    hasPermissionMock.mockResolvedValue(false);
    scheduleEntryGetMock.mockResolvedValue({ ...EXISTING_ENTRY, assigned_user_ids: ['user-1'] });
    const result = await updateScheduleEntry('entry-1', { title: 'Changed', assigned_user_ids });
    expect(result).toMatchObject({ success: false, error: expect.stringContaining('Permission denied') });
    expect(hasPermissionMock).toHaveBeenCalledWith(authState.currentUser, 'user_schedule', 'update', expect.anything());
    expect(scheduleEntryUpdateMock).not.toHaveBeenCalled();
    expect(publishEventMock).not.toHaveBeenCalled();
    expect(maybePublishCapacityThresholdReachedMock).not.toHaveBeenCalled();
  });

  it.each(['user-1', 'user-2'])('denies deletion of non-private entries assigned to %s without update permission', async (assignee) => {
    const { deleteScheduleEntry } = await import('../src/actions/scheduleActions');
    hasPermissionMock.mockResolvedValue(false);
    scheduleEntryGetMock.mockResolvedValue({ ...EXISTING_ENTRY, assigned_user_ids: [assignee] });
    const result = await deleteScheduleEntry('entry-1');
    expect(result).toMatchObject({ success: false, canDelete: false, code: 'PERMISSION_DENIED' });
    expect(hasPermissionMock).toHaveBeenCalledWith(authState.currentUser, 'user_schedule', 'update', expect.anything());
    expect(deleteEntityWithValidationMock).not.toHaveBeenCalled();
    expect(scheduleEntryDeleteMock).not.toHaveBeenCalled();
    expect(deleteTeamsMeetingMock).not.toHaveBeenCalled();
    expect(publishEventMock).not.toHaveBeenCalled();
  });

  it('updates and reschedules an entry with update permission using the authenticated tenant', async () => {
    const { updateScheduleEntry } = await import('../src/actions/scheduleActions');
    const patch = { title: 'Rescheduled', scheduled_start: new Date('2026-09-05T15:00:00Z'), scheduled_end: new Date('2026-09-05T16:00:00Z') };
    const result = await updateScheduleEntry('entry-1', patch);
    expect(result).toMatchObject({ success: true, entry: patch });
    expect(scheduleEntryGetMock).toHaveBeenCalledWith(expect.anything(), 'tenant-1', 'entry-1');
    expect(scheduleEntryUpdateMock).toHaveBeenCalledWith(expect.anything(), 'tenant-1', 'entry-1', expect.objectContaining(patch), undefined);
  });

  it('deletes a non-private entry with update permission using the authenticated tenant', async () => {
    const { deleteScheduleEntry } = await import('../src/actions/scheduleActions');
    const result = await deleteScheduleEntry('entry-1');
    expect(result).toMatchObject({ success: true, deleted: true });
    expect(scheduleEntryDeleteMock).toHaveBeenCalledWith(expect.anything(), 'tenant-1', 'entry-1', 'single');
  });

  it('still denies edits and deletion of another user’s private entry with update permission', async () => {
    const { updateScheduleEntry, deleteScheduleEntry } = await import('../src/actions/scheduleActions');
    scheduleEntryGetMock.mockResolvedValue({ ...EXISTING_ENTRY, is_private: true });
    expect(await updateScheduleEntry('entry-1', { title: 'Changed' })).toMatchObject({ success: false });
    expect(await deleteScheduleEntry('entry-1')).toMatchObject({ success: false, isPrivateError: true });
    expect(scheduleEntryUpdateMock).not.toHaveBeenCalled();
    expect(deleteEntityWithValidationMock).not.toHaveBeenCalled();
  });
});
