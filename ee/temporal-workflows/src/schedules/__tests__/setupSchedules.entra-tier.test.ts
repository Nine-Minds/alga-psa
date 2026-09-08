import { beforeEach, describe, expect, it, vi } from 'vitest';

const scheduleCreateMock = vi.fn();
const scheduleDeleteMock = vi.fn();
const scheduleListMock = vi.fn();
const resolveTenantTierMock = vi.fn();

const entraSettingsRows: Array<Record<string, unknown>> = [];

vi.mock('@temporalio/client', () => ({
  Connection: {
    connect: vi.fn(async () => ({})),
  },
  Client: vi.fn(() => ({
    schedule: {
      create: scheduleCreateMock,
      getHandle: vi.fn((scheduleId: string) => ({
        update: vi.fn(),
        delete: () => scheduleDeleteMock(scheduleId),
        trigger: vi.fn(),
      })),
      list: scheduleListMock,
    },
  })),
  ScheduleOverlapPolicy: {
    SKIP: 'SKIP',
  },
}));

vi.mock('@ee/lib/integrations/ninjaone/proactiveRefresh', () => ({
  seedNinjaOneProactiveRefreshFromStoredCredentials: vi.fn(),
}));

vi.mock('@alga-psa/db/admin.js', () => ({
  getAdminConnection: vi.fn(async () => ({})),
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: vi.fn((_knex: unknown, context: string) => {
    const rows = context.includes('entra') ? entraSettingsRows : [];
    const query: Record<string, unknown> = {
      where: vi.fn(() => query),
      join: vi.fn(() => query),
      whereNull: vi.fn(() => query),
      select: vi.fn(async () => rows),
    };
    return {
      unscoped: vi.fn(() => query),
      tenantJoin: vi.fn(),
    };
  }),
}));

vi.mock('@alga-psa/licensing', () => ({
  resolveTenantTier: resolveTenantTierMock,
}));

const ENTRA_PREFIX = 'entra-all-tenants-sync-schedule';

describe('setupSchedules Entra tier gating', () => {
  it('schedules installation restore recovery without tenant or paid-tier prerequisites', async () => {
    const { setupSchedules } = await import('../setupSchedules');
    await setupSchedules();
    expect(scheduleCreateMock).toHaveBeenCalledWith(expect.objectContaining({
      scheduleId: 'maintenance-fanout:portable-restore-upload-cleanup',
      spec: { cronExpressions: ['*/15 * * * *'] },
      action: expect.objectContaining({ args: [{ jobName: 'portable-restore-upload-cleanup' }] }),
    }));
    expect(resolveTenantTierMock).not.toHaveBeenCalled();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    entraSettingsRows.length = 0;
    scheduleCreateMock.mockResolvedValue(undefined);
    scheduleDeleteMock.mockResolvedValue(undefined);
    scheduleListMock.mockImplementation(() => ({
      // eslint-disable-next-line require-yield
      async *[Symbol.asyncIterator]() {},
    }));
  });

  it('creates a schedule for a Pro tenant with no Enterprise add-on', async () => {
    entraSettingsRows.push({
      tenantId: 'tenant-pro',
      syncEnabled: true,
      syncIntervalMinutes: 720,
      activeConnectionId: 'connection-1',
    });
    resolveTenantTierMock.mockResolvedValue('pro');

    const { setupSchedules } = await import('../setupSchedules');
    await setupSchedules();

    expect(scheduleCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduleId: `${ENTRA_PREFIX}:tenant-pro`,
        spec: { intervals: [{ every: '720m' }] },
      })
    );
    expect(scheduleDeleteMock).not.toHaveBeenCalledWith(`${ENTRA_PREFIX}:tenant-pro`);
  });

  it('deletes the schedule for a tenant below the Entra tier', async () => {
    entraSettingsRows.push({
      tenantId: 'tenant-solo',
      syncEnabled: true,
      syncIntervalMinutes: 1440,
      activeConnectionId: 'connection-2',
    });
    resolveTenantTierMock.mockResolvedValue('solo');

    const { setupSchedules } = await import('../setupSchedules');
    await setupSchedules();

    expect(scheduleDeleteMock).toHaveBeenCalledWith(`${ENTRA_PREFIX}:tenant-solo`);
    expect(scheduleCreateMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ scheduleId: `${ENTRA_PREFIX}:tenant-solo` })
    );
  });

  it('leaves the schedule alone when the tier lookup fails', async () => {
    entraSettingsRows.push({
      tenantId: 'tenant-flaky',
      syncEnabled: true,
      syncIntervalMinutes: 1440,
      activeConnectionId: 'connection-3',
    });
    resolveTenantTierMock.mockRejectedValue(new Error('database unavailable'));

    const { setupSchedules } = await import('../setupSchedules');
    await setupSchedules();

    expect(scheduleDeleteMock).not.toHaveBeenCalledWith(`${ENTRA_PREFIX}:tenant-flaky`);
    expect(scheduleCreateMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ scheduleId: `${ENTRA_PREFIX}:tenant-flaky` })
    );
  });
});
