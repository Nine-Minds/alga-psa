import { beforeEach, describe, expect, it, vi } from 'vitest';

const scheduleCreateMock = vi.fn();
const scheduleUpdateMock = vi.fn();
const scheduleDeleteMock = vi.fn();
const seedBackfillMock = vi.fn(async () => ({ scheduled: true }));
const connectMock = vi.fn(async () => ({}));

const state = {
  ninjaRows: [] as Array<{ tenantId: string; integrationId: string; settings: unknown }>,
};

vi.mock('@temporalio/client', () => ({
  Connection: {
    connect: connectMock,
  },
  Client: vi.fn(() => ({
    schedule: {
      create: scheduleCreateMock,
      getHandle: vi.fn(() => ({
        update: scheduleUpdateMock,
        delete: scheduleDeleteMock,
      })),
    },
  })),
  ScheduleOverlapPolicy: {
    SKIP: 'SKIP',
  },
}));

vi.mock('@ee/lib/integrations/ninjaone/proactiveRefresh', () => ({
  seedNinjaOneProactiveRefreshFromStoredCredentials: seedBackfillMock,
}));

vi.mock('@alga-psa/db/admin.js', () => ({
  getAdminConnection: vi.fn(async () => {
    const builder = {
      where: vi.fn(() => builder),
      leftJoin: vi.fn(() => builder),
      select: vi.fn(async () => {
        return state.ninjaRows.map((row) => ({
          tenantId: row.tenantId,
          integrationId: row.integrationId,
          settings: row.settings,
          activeConnectionId: null,
          syncEnabled: false,
          syncIntervalMinutes: 60,
        }));
      }),
    };

    return vi.fn(() => builder);
  }),
}));

describe('setupSchedules ninjaone backfill', () => {
  beforeEach(() => {
    scheduleCreateMock.mockReset();
    scheduleUpdateMock.mockReset();
    scheduleDeleteMock.mockReset();
    seedBackfillMock.mockReset();
    connectMock.mockReset();

    seedBackfillMock.mockResolvedValue({ scheduled: true });

    state.ninjaRows = [
      { tenantId: 'tenant-1', integrationId: 'integration-seed', settings: '{}' },
      {
        tenantId: 'tenant-2',
        integrationId: 'integration-owned',
        settings: JSON.stringify({ tokenLifecycle: { nextRefreshAt: '2026-03-27T00:00:00.000Z' } }),
      },
      {
        tenantId: 'tenant-3',
        integrationId: 'integration-reconnect',
        settings: JSON.stringify({ tokenLifecycle: { reconnectRequired: true } }),
      },
    ];
  });

  it('seeds proactive refresh for active integrations that still need lifecycle ownership', async () => {
    const { setupSchedules } = await import('../setupSchedules');

    await setupSchedules();

    expect(seedBackfillMock).toHaveBeenCalledTimes(2);
    expect(seedBackfillMock).toHaveBeenNthCalledWith(1, {
      tenantId: 'tenant-1',
      integrationId: 'integration-seed',
      source: 'backfill',
    });
    expect(seedBackfillMock).toHaveBeenNthCalledWith(2, {
      tenantId: 'tenant-2',
      integrationId: 'integration-owned',
      source: 'backfill',
    });
  });
});
