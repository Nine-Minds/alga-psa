import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  assertMspPermissionMock: vi.fn(),
  hasPermissionAsyncMock: vi.fn(),
  createInteractionWithSideEffectsMock: vi.fn(),
  createInteractionScheduleEntryMock: vi.fn(),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) =>
    fn({ user_id: 'user-1', user_type: 'internal' }, { tenant: 'tenant-1' }, ...args),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {} as any }),
  tenantDb: () => ({ table: vi.fn() }),
  withTransaction: async (_db: any, fn: any) => fn({} as any),
}));

vi.mock('@alga-psa/storage/StorageService', () => ({
  StorageService: { deleteFile: vi.fn() },
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('@alga-psa/shared/models/scheduleEntry', () => ({
  default: { create: vi.fn(), update: vi.fn(), delete: vi.fn(), getByWorkItem: vi.fn() },
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(),
  publishWorkflowEvent: vi.fn(),
}));

vi.mock('@alga-psa/workflow-streams', () => ({
  buildInteractionLoggedPayload: vi.fn(),
}));

vi.mock('../models/interactions', () => ({
  default: { addInteraction: vi.fn() },
}));

vi.mock('../lib/authHelpers', () => ({
  assertMspPermission: (...args: any[]) => hoisted.assertMspPermissionMock(...args),
  hasPermissionAsync: (...args: any[]) => hoisted.hasPermissionAsyncMock(...args),
}));

// Keeps the real resolveScheduleAssignees so the action is tested against the same
// de-duplication the schedule entry itself uses.
vi.mock('./interactionCreateHelper', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./interactionCreateHelper')>();
  return {
    ...actual,
    createInteractionWithSideEffects: hoisted.createInteractionWithSideEffectsMock,
    createInteractionScheduleEntry: hoisted.createInteractionScheduleEntryMock,
    deleteInteractionScheduleEntries: vi.fn(),
    syncInteractionScheduleEntries: vi.fn(),
    publishInteractionSearchEvent: vi.fn(),
  };
});

function interactionInput() {
  return {
    type_id: 'type-1',
    title: 'Follow-up call',
    user_id: 'user-1',
    client_id: 'client-1',
    tenant: 'tenant-1',
  } as any;
}

describe('addInteraction schedule assignees', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.assertMspPermissionMock.mockResolvedValue(undefined);
    hoisted.createInteractionWithSideEffectsMock.mockResolvedValue({
      interaction: { interaction_id: 'interaction-1', title: 'Follow-up call' },
      publishSideEffects: vi.fn(),
    });
    hoisted.createInteractionScheduleEntryMock.mockResolvedValue({
      entry: { entry_id: 'schedule-entry-1' },
      publishScheduleEntryCreated: vi.fn(),
    });
  });

  it('books the requested colleagues when the user may update their schedules', async () => {
    hoisted.hasPermissionAsyncMock.mockResolvedValue(true);

    const { addInteraction } = await import('./interactionActions');
    const result = await addInteraction(interactionInput(), {
      createScheduleEntry: true,
      scheduleAssignedUserIds: ['user-2', 'user-2', ''],
    });

    expect(result).toMatchObject({ interaction_id: 'interaction-1' });
    expect(hoisted.hasPermissionAsyncMock).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-1' }),
      'user_schedule',
      'update',
      expect.anything(),
    );
    expect(hoisted.createInteractionScheduleEntryMock).toHaveBeenCalledWith(
      expect.objectContaining({ assignedUserIds: ['user-2'], assignedByUserId: 'user-1' }),
    );
  });

  it('refuses to book someone else without user_schedule:update', async () => {
    hoisted.hasPermissionAsyncMock.mockResolvedValue(false);

    const { addInteraction } = await import('./interactionActions');
    const result = await addInteraction(interactionInput(), {
      createScheduleEntry: true,
      scheduleAssignedUserIds: ['user-2'],
    });

    expect(result).toMatchObject({
      permissionError: 'Permission denied to assign schedule entries to other users.',
      messageKey: 'msp/clients:errors.interaction.scheduleAssignDenied',
    });
    expect(hoisted.createInteractionWithSideEffectsMock).not.toHaveBeenCalled();
    expect(hoisted.createInteractionScheduleEntryMock).not.toHaveBeenCalled();
  });

  it('never checks the schedule permission when booking only your own calendar', async () => {
    hoisted.hasPermissionAsyncMock.mockResolvedValue(false);

    const { addInteraction } = await import('./interactionActions');
    await addInteraction(interactionInput(), { createScheduleEntry: true });

    expect(hoisted.hasPermissionAsyncMock).not.toHaveBeenCalled();
    expect(hoisted.createInteractionScheduleEntryMock).toHaveBeenCalledWith(
      expect.objectContaining({ assignedUserIds: ['user-1'] }),
    );
  });

  it('skips the check when others are listed but nothing is being scheduled', async () => {
    hoisted.hasPermissionAsyncMock.mockResolvedValue(false);

    const { addInteraction } = await import('./interactionActions');
    const result = await addInteraction(interactionInput(), {
      scheduleAssignedUserIds: ['user-2'],
    });

    expect(result).toMatchObject({ interaction_id: 'interaction-1' });
    expect(hoisted.hasPermissionAsyncMock).not.toHaveBeenCalled();
    expect(hoisted.createInteractionScheduleEntryMock).not.toHaveBeenCalled();
  });
});
