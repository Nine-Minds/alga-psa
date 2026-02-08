import { beforeEach, describe, expect, it, vi } from 'vitest';

const temporalClientMocks = vi.hoisted(() => {
  return {
    schedule: {
      getHandle: vi.fn(),
      create: vi.fn(),
    },
  };
});

const dbMocks = vi.hoisted(() => {
  return {
    insertedJobRow: null as Record<string, unknown> | null,
    firstUserId: 'seed-user-id',
  };
});

vi.mock('@temporalio/client', () => {
  const Client = vi.fn(() => ({ schedule: temporalClientMocks.schedule, workflow: { start: vi.fn() } }));
  const Connection = { connect: vi.fn(async () => ({})) };
  return { Client, Connection };
});

vi.mock('server/src/lib/db', () => {
  const runWithTenant = vi.fn(async (_tenantId: string, cb: () => Promise<unknown>) => cb());

  const createTenantKnex = vi.fn(async () => {
    const knex = ((table: string) => {
      if (table === 'users') {
        return {
          where: () => ({
            orderBy: () => ({
              first: async () =>
                dbMocks.firstUserId ? { user_id: dbMocks.firstUserId } : undefined,
            }),
          }),
        };
      }

      if (table === 'jobs') {
        return {
          insert: (row: Record<string, unknown>) => {
            dbMocks.insertedJobRow = row;
            return {
              returning: async () => [{ job_id: 'job-created-from-test' }],
            };
          },
          where: () => ({
            update: async () => 1,
          }),
        };
      }

      throw new Error(`Unexpected table requested in test: ${table}`);
    }) as unknown as any;

    return { knex };
  });

  return { createTenantKnex, runWithTenant };
});

describe('TemporalJobRunner createJobRecord user attribution', () => {
  beforeEach(() => {
    dbMocks.insertedJobRow = null;
    dbMocks.firstUserId = 'seed-user-id';
    temporalClientMocks.schedule.getHandle.mockReset();
    temporalClientMocks.schedule.create.mockReset();
    temporalClientMocks.schedule.getHandle.mockReturnValue({
      describe: vi.fn(async () => {
        throw new Error('not found');
      }),
    });
  });

  it('uses a real tenant user_id when scheduling recurring jobs without explicit userId', async () => {
    const { TemporalJobRunner } = await import('@ee/lib/jobs/runners/TemporalJobRunner');
    TemporalJobRunner.reset();

    const runner = await TemporalJobRunner.create({
      address: 'temporal.test:7233',
      namespace: 'default',
      taskQueue: 'alga-jobs',
    });

    (runner as any).updateJobExternalIds = vi.fn(async () => undefined);
    (runner as any).updateJobStatus = vi.fn(async () => undefined);

    await runner.scheduleRecurringJob(
      'extension-scheduled-invocation',
      { tenantId: 'tenant-1' } as any,
      '*/5 * * * *',
      { singletonKey: 'extsched:install-1:sched-1' }
    );

    expect(dbMocks.insertedJobRow).toBeTruthy();
    expect((dbMocks.insertedJobRow as any).user_id).toBe('seed-user-id');
    expect((dbMocks.insertedJobRow as any).user_id).not.toBe('tenant-1');
  });
});
