import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTRACT_CADENCE_REPLENISHMENT_JOB_NAME } from '@alga-psa/types';

const scheduleCreateMock = vi.fn();
const scheduleUpdateMock = vi.fn();
const scheduleDeleteMock = vi.fn();
const scheduleTriggerMock = vi.fn();
const scheduleListMock = vi.fn();
const connectMock = vi.fn(async () => ({}));
const knownScheduleIds = new Set<string>();

vi.mock('@temporalio/client', () => ({
  Connection: {
    connect: connectMock,
  },
  Client: vi.fn(function () { return ({
    schedule: {
      create: scheduleCreateMock,
      getHandle: vi.fn((scheduleId: string) => ({
        update: (updater: (previous: Record<string, unknown>) => unknown) => {
          scheduleUpdateMock(scheduleId, updater({}));
        },
        delete: () => scheduleDeleteMock(scheduleId),
        trigger: scheduleTriggerMock,
      })),
      list: scheduleListMock,
    },
  }); }),
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
  tenantDb: vi.fn(() => {
    const query = {
      where: vi.fn(() => query),
      join: vi.fn(() => query),
      whereNull: vi.fn(() => query),
      select: vi.fn(async () => []),
    };
    return {
      unscoped: vi.fn(() => query),
      tenantJoin: vi.fn(),
    };
  }),
}));

describe('setupSchedules contract-cadence replenishment fan-out', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    knownScheduleIds.clear();
    scheduleCreateMock.mockImplementation(async ({ scheduleId }) => {
      if (knownScheduleIds.has(scheduleId)) {
        throw { code: 6 };
      }
      knownScheduleIds.add(scheduleId);
    });
    scheduleListMock.mockImplementation(() => ({
      async *[Symbol.asyncIterator]() {
        yield* [];
      },
    }));
  });

  it('schedules the daily contract-cadence replenishment maintenance fan-out', async () => {
    const { setupSchedules } = await import('../setupSchedules');

    await setupSchedules();

    const created = scheduleCreateMock.mock.calls
      .map(([input]) => input)
      .find(
        ({ scheduleId }) =>
          scheduleId === `maintenance-fanout:${CONTRACT_CADENCE_REPLENISHMENT_JOB_NAME}`,
      );

    expect(created).toEqual(
      expect.objectContaining({
        scheduleId: `maintenance-fanout:${CONTRACT_CADENCE_REPLENISHMENT_JOB_NAME}`,
        spec: { cronExpressions: ['0 4 * * *'] },
        action: expect.objectContaining({
          workflowType: expect.any(Function),
          args: [{ jobName: CONTRACT_CADENCE_REPLENISHMENT_JOB_NAME }],
          taskQueue: 'tenant-workflows',
          workflowExecutionTimeout: '20m',
        }),
        policies: { overlap: 'SKIP', catchupWindow: '1m' },
      }),
    );
  });

  it('updates the same schedule ID on repeated setup instead of duplicating it', async () => {
    const { setupSchedules } = await import('../setupSchedules');

    await setupSchedules();
    await setupSchedules();

    expect(
      scheduleUpdateMock.mock.calls
        .map(([scheduleId]) => scheduleId)
        .filter((scheduleId: string) => scheduleId.endsWith(CONTRACT_CADENCE_REPLENISHMENT_JOB_NAME)),
    ).toEqual([`maintenance-fanout:${CONTRACT_CADENCE_REPLENISHMENT_JOB_NAME}`]);
  });
});
