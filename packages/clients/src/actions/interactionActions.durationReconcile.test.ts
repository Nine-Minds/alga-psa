import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  assertMspPermissionMock: vi.fn(),
  hasPermissionAsyncMock: vi.fn(),
  createInteractionWithSideEffectsMock: vi.fn(),
  getByIdMock: vi.fn(),
  updateInteractionMock: vi.fn(),
  syncInteractionScheduleEntriesMock: vi.fn(),
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
  default: {
    addInteraction: vi.fn(),
    getById: (...args: any[]) => hoisted.getByIdMock(...args),
    updateInteraction: (...args: any[]) => hoisted.updateInteractionMock(...args),
  },
}));

vi.mock('../lib/authHelpers', () => ({
  assertMspPermission: (...args: any[]) => hoisted.assertMspPermissionMock(...args),
  hasPermissionAsync: (...args: any[]) => hoisted.hasPermissionAsyncMock(...args),
}));

vi.mock('./interactionCreateHelper', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./interactionCreateHelper')>();
  return {
    ...actual,
    createInteractionWithSideEffects: hoisted.createInteractionWithSideEffectsMock,
    createInteractionScheduleEntry: vi.fn(),
    deleteInteractionScheduleEntries: vi.fn(),
    syncInteractionScheduleEntries: hoisted.syncInteractionScheduleEntriesMock,
    publishInteractionSearchEvent: vi.fn(),
  };
});

const START = new Date('2026-10-01T09:00:00.000Z');

function interactionInput(overrides: Record<string, unknown> = {}) {
  return {
    type_id: 'type-1',
    title: 'Follow-up call',
    user_id: 'user-1',
    client_id: 'client-1',
    tenant: 'tenant-1',
    ...overrides,
  } as any;
}

describe('interaction duration reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.assertMspPermissionMock.mockResolvedValue(undefined);
    hoisted.hasPermissionAsyncMock.mockResolvedValue(true);
    hoisted.createInteractionWithSideEffectsMock.mockResolvedValue({
      interaction: { interaction_id: 'interaction-1', title: 'Follow-up call' },
      publishSideEffects: vi.fn(),
    });
    hoisted.updateInteractionMock.mockImplementation(async (_id: string, updateData: any) => ({
      interaction_id: 'interaction-1',
      title: 'Follow-up call',
      ...updateData,
    }));
  });

  it('refuses a create whose duration disagrees with a 72-hour range', async () => {
    const { addInteraction } = await import('./interactionActions');

    const result = await addInteraction(interactionInput({
      duration: 1440,
      start_time: START,
      end_time: new Date('2026-10-04T09:00:00.000Z'),
    }));

    expect(result).toMatchObject({ actionError: "Interactions can't be longer than 24 hours." });
    expect(hoisted.createInteractionWithSideEffectsMock).not.toHaveBeenCalled();
  });

  it('refuses a create whose end time precedes its start time', async () => {
    const { addInteraction } = await import('./interactionActions');

    const result = await addInteraction(interactionInput({
      duration: 60,
      start_time: START,
      end_time: new Date('2026-10-01T08:00:00.000Z'),
    }));

    expect(result).toMatchObject({ actionError: 'End time must be on or after the start time.' });
    expect(hoisted.createInteractionWithSideEffectsMock).not.toHaveBeenCalled();
  });

  it('normalizes a create duration to the range it was sent with', async () => {
    const { addInteraction } = await import('./interactionActions');

    await addInteraction(interactionInput({
      duration: 15,
      start_time: START,
      end_time: new Date('2026-10-01T11:30:00.000Z'),
    }));

    expect(hoisted.createInteractionWithSideEffectsMock).toHaveBeenCalledWith(
      expect.objectContaining({ interactionData: expect.objectContaining({ duration: 150 }) }),
    );
  });

  it('clamps a create duration that has no range to measure against', async () => {
    const { addInteraction } = await import('./interactionActions');

    await addInteraction(interactionInput({ duration: 4320, start_time: START }));

    expect(hoisted.createInteractionWithSideEffectsMock).toHaveBeenCalledWith(
      expect.objectContaining({ interactionData: expect.objectContaining({ duration: 1440 }) }),
    );
  });

  it('passes a consistent sub-cap create payload through untouched', async () => {
    const { addInteraction } = await import('./interactionActions');
    const payload = interactionInput({
      duration: 150,
      start_time: START,
      end_time: new Date('2026-10-01T11:30:00.000Z'),
    });

    await addInteraction(payload);

    expect(hoisted.createInteractionWithSideEffectsMock).toHaveBeenCalledWith(
      expect.objectContaining({ interactionData: payload }),
    );
    expect(hoisted.createInteractionWithSideEffectsMock.mock.calls[0][0].interactionData).toBe(payload);
  });

  it('merges an end-time-only update with the stored row and rewrites the duration', async () => {
    hoisted.getByIdMock.mockResolvedValue({
      interaction_id: 'interaction-1',
      start_time: START,
      end_time: new Date('2026-10-01T09:30:00.000Z'),
      duration: 30,
    });
    const { updateInteraction } = await import('./interactionActions');

    const result = await updateInteraction('interaction-1', {
      end_time: new Date('2026-10-01T11:00:00.000Z'),
    });

    expect(hoisted.updateInteractionMock).toHaveBeenCalledWith(
      'interaction-1',
      { end_time: new Date('2026-10-01T11:00:00.000Z'), duration: 120 },
      'tenant-1',
      expect.anything(),
    );
    // The calendar block is resized from the same reconciled record.
    expect(hoisted.syncInteractionScheduleEntriesMock).toHaveBeenCalledWith(
      expect.anything(),
      'tenant-1',
      expect.objectContaining({ duration: 120 }),
    );
    expect(result).toMatchObject({ duration: 120 });
  });

  it('refuses an update that would stretch the stored range past the cap', async () => {
    hoisted.getByIdMock.mockResolvedValue({
      interaction_id: 'interaction-1',
      start_time: START,
      end_time: new Date('2026-10-01T09:30:00.000Z'),
      duration: 30,
    });
    const { updateInteraction } = await import('./interactionActions');

    const result = await updateInteraction('interaction-1', {
      end_time: new Date('2026-10-04T09:00:00.000Z'),
    });

    expect(result).toMatchObject({ actionError: "Interactions can't be longer than 24 hours." });
    expect(hoisted.updateInteractionMock).not.toHaveBeenCalled();
    expect(hoisted.syncInteractionScheduleEntriesMock).not.toHaveBeenCalled();
  });

  it('leaves an update that agrees with the merged range byte-identical', async () => {
    hoisted.getByIdMock.mockResolvedValue({
      interaction_id: 'interaction-1',
      start_time: START,
      end_time: new Date('2026-10-01T09:30:00.000Z'),
      duration: 30,
    });
    const { updateInteraction } = await import('./interactionActions');
    const updateData = {
      duration: 120,
      start_time: START,
      end_time: new Date('2026-10-01T11:00:00.000Z'),
    };

    await updateInteraction('interaction-1', updateData);

    expect(hoisted.updateInteractionMock).toHaveBeenCalledWith(
      'interaction-1',
      updateData,
      'tenant-1',
      expect.anything(),
    );
    expect(hoisted.updateInteractionMock.mock.calls[0][1]).toBe(updateData);
  });

  it('never reads the stored row for an update that leaves the window alone', async () => {
    const { updateInteraction } = await import('./interactionActions');

    await updateInteraction('interaction-1', { title: 'Renamed' });

    expect(hoisted.getByIdMock).not.toHaveBeenCalled();
    expect(hoisted.updateInteractionMock).toHaveBeenCalledWith(
      'interaction-1',
      { title: 'Renamed' },
      'tenant-1',
      expect.anything(),
    );
  });
});
