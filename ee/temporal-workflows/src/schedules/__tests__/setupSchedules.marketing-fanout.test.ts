import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MARKETING_EXPIRE_STALE_TARGETS_JOB,
  MARKETING_FLIP_DUE_POSTS_JOB,
  MARKETING_SEND_SEQUENCE_STEPS_JOB,
} from '@alga-psa/marketing/lib/marketingJobContract';

const scheduleCreateMock = vi.fn();
const scheduleUpdateMock = vi.fn();
const scheduleDeleteMock = vi.fn();
const scheduleTriggerMock = vi.fn();
const scheduleListMock = vi.fn();
const connectMock = vi.fn(async () => ({}));
const events: string[] = [];
const knownScheduleIds = new Set<string>();

const listedScheduleIds = [
  `${MARKETING_FLIP_DUE_POSTS_JOB}:tenant-1`,
  `${MARKETING_EXPIRE_STALE_TARGETS_JOB}:tenant-2`,
  `${MARKETING_SEND_SEQUENCE_STEPS_JOB}:tenant-missing`,
  'marketing-fanout:flip-due-posts',
  'unrelated:schedule',
];

vi.mock('@temporalio/client', () => ({
  Connection: {
    connect: connectMock,
  },
  Client: vi.fn(() => ({
    schedule: {
      create: scheduleCreateMock,
      getHandle: vi.fn((scheduleId: string) => ({
        update: (updater: (previous: Record<string, unknown>) => unknown) => {
          scheduleUpdateMock(scheduleId, updater({}));
          events.push(`update:${scheduleId}`);
        },
        delete: () => scheduleDeleteMock(scheduleId),
        trigger: scheduleTriggerMock,
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
    const rows = context.includes('entra') ? [] : [];
    const query = {
      where: vi.fn(() => query),
      select: vi.fn(async () => rows),
    };
    return {
      unscoped: vi.fn(() => query),
      tenantJoin: vi.fn(),
    };
  }),
}));

describe('setupSchedules marketing fan-out cutover', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    events.length = 0;
    knownScheduleIds.clear();

    scheduleCreateMock.mockImplementation(async ({ scheduleId }) => {
      events.push(`upsert:${scheduleId}`);
      if (knownScheduleIds.has(scheduleId)) {
        throw { code: 6 };
      }
      knownScheduleIds.add(scheduleId);
    });
    scheduleDeleteMock.mockImplementation(async (scheduleId: string) => {
      events.push(`delete:${scheduleId}`);
      if (scheduleId.endsWith('tenant-missing')) {
        throw { code: 5 };
      }
    });
    scheduleListMock.mockImplementation(() => ({
      async *[Symbol.asyncIterator]() {
        events.push('list');
        for (const scheduleId of listedScheduleIds) {
          yield { scheduleId };
        }
      },
    }));
  });

  it('upserts the exact global schedules before deleting only legacy tenant schedules', async () => {
    const { setupSchedules } = await import('../setupSchedules');

    await setupSchedules();

    const marketingCreates = scheduleCreateMock.mock.calls
      .map(([input]) => input)
      .filter(({ scheduleId }) => scheduleId.startsWith('marketing-fanout:'));
    expect(marketingCreates).toEqual([
      expect.objectContaining({
        scheduleId: 'marketing-fanout:flip-due-posts',
        spec: { cronExpressions: ['*/5 * * * *'] },
        action: expect.objectContaining({
          workflowType: expect.any(Function),
          args: [{ jobName: MARKETING_FLIP_DUE_POSTS_JOB }],
          taskQueue: 'tenant-workflows',
          workflowExecutionTimeout: '1h',
        }),
        policies: { overlap: 'SKIP', catchupWindow: '1m' },
      }),
      expect.objectContaining({
        scheduleId: 'marketing-fanout:send-sequence-steps',
        spec: { cronExpressions: ['*/5 * * * *'] },
        action: expect.objectContaining({
          workflowType: expect.any(Function),
          args: [{ jobName: MARKETING_SEND_SEQUENCE_STEPS_JOB }],
          taskQueue: 'tenant-workflows',
          workflowExecutionTimeout: '1h',
        }),
        policies: { overlap: 'SKIP', catchupWindow: '1m' },
      }),
      expect.objectContaining({
        scheduleId: 'marketing-fanout:expire-stale-targets',
        spec: { cronExpressions: ['11 * * * *'] },
        action: expect.objectContaining({
          workflowType: expect.any(Function),
          args: [{ jobName: MARKETING_EXPIRE_STALE_TARGETS_JOB }],
          taskQueue: 'tenant-workflows',
          workflowExecutionTimeout: '1h',
        }),
        policies: { overlap: 'SKIP', catchupWindow: '1m' },
      }),
    ]);

    const firstDelete = events.findIndex((event) => event.startsWith('delete:marketing:'));
    for (const scheduleId of [
      'marketing-fanout:flip-due-posts',
      'marketing-fanout:send-sequence-steps',
      'marketing-fanout:expire-stale-targets',
    ]) {
      expect(events.indexOf(`upsert:${scheduleId}`)).toBeLessThan(firstDelete);
    }
    expect(scheduleDeleteMock.mock.calls.map(([scheduleId]) => scheduleId)).toEqual([
      `${MARKETING_FLIP_DUE_POSTS_JOB}:tenant-1`,
      `${MARKETING_EXPIRE_STALE_TARGETS_JOB}:tenant-2`,
      `${MARKETING_SEND_SEQUENCE_STEPS_JOB}:tenant-missing`,
    ]);
  });

  it('updates the same global IDs on repeat setup and tolerates not-found cleanup races', async () => {
    const { setupSchedules } = await import('../setupSchedules');

    await expect(setupSchedules()).resolves.toBeUndefined();
    await expect(setupSchedules()).resolves.toBeUndefined();

    expect(scheduleUpdateMock.mock.calls
      .map(([scheduleId]) => scheduleId)
      .filter((scheduleId) => scheduleId.startsWith('marketing-fanout:')))
      .toEqual([
        'marketing-fanout:flip-due-posts',
        'marketing-fanout:send-sequence-steps',
        'marketing-fanout:expire-stale-targets',
      ]);
    expect(scheduleDeleteMock).toHaveBeenCalledWith(
      `${MARKETING_SEND_SEQUENCE_STEPS_JOB}:tenant-missing`,
    );
  });
});
