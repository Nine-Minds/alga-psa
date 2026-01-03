import { describe, expect, it, vi } from 'vitest';

import type { ScheduleJobOptions } from 'server/src/lib/jobs/interfaces';

vi.mock('@temporalio/client', () => {
  const schedule = {
    getHandle: vi.fn(),
    create: vi.fn(),
  };

  const Client = vi.fn(() => ({ schedule, workflow: { start: vi.fn() } }));
  const Connection = { connect: vi.fn(async () => ({})) };

  return { Client, Connection };
});

describe('TemporalJobRunner.scheduleRecurringJob', () => {
  it('uses singletonKey as scheduleId and creates schedule with timezoneName', async () => {
    const { TemporalJobRunner } = await import('@ee/lib/jobs/runners/TemporalJobRunner');
    TemporalJobRunner.reset();

    const { Client } = await import('@temporalio/client');
    const runner = await TemporalJobRunner.create({
      address: 'temporal.test:7233',
      namespace: 'default',
      taskQueue: 'alga-jobs',
    });
    const client = (Client as any).mock.results.at(-1)?.value;
    client.schedule.create.mockClear();
    client.schedule.getHandle.mockClear();

    // Stub DB-facing methods.
    (runner as any).createJobRecord = vi.fn(async () => ({ jobId: 'job-1' }));
    (runner as any).updateJobExternalIds = vi.fn(async () => undefined);
    (runner as any).updateJobStatus = vi.fn(async () => undefined);

    // Schedule does not exist yet => describe throws => create is called.
    const handle = { describe: vi.fn(async () => { throw new Error('not found'); }) };
    client.schedule.getHandle.mockReturnValue(handle);

    const opts: ScheduleJobOptions = {
      singletonKey: 'extsched:install-1:sched-1',
      metadata: { timezone: 'UTC' },
    };

    const out = await runner.scheduleRecurringJob(
      'extension-scheduled-invocation',
      { tenantId: 'tenant-1' } as any,
      '0 1 * * *',
      opts
    );

    expect(out.externalId).toBe('extsched:install-1:sched-1');
    expect(client.schedule.getHandle).toHaveBeenCalledWith('extsched:install-1:sched-1');
    expect(client.schedule.create).toHaveBeenCalledTimes(1);

    const arg = client.schedule.create.mock.calls[0][0];
    expect(arg.scheduleId).toBe('extsched:install-1:sched-1');
    expect(arg.spec.timezoneName).toBe('UTC');
    expect(arg.action?.workflowType).toBe('genericJobWorkflow');
  });

  it('does not create schedule when it already exists', async () => {
    const { TemporalJobRunner } = await import('@ee/lib/jobs/runners/TemporalJobRunner');
    TemporalJobRunner.reset();

    const { Client } = await import('@temporalio/client');
    const runner = await TemporalJobRunner.create({
      address: 'temporal.test:7233',
      namespace: 'default',
      taskQueue: 'alga-jobs',
    });
    const client = (Client as any).mock.results.at(-1)?.value;
    client.schedule.create.mockClear();
    client.schedule.getHandle.mockClear();

    (runner as any).createJobRecord = vi.fn(async () => ({ jobId: 'job-2' }));
    (runner as any).updateJobExternalIds = vi.fn(async () => undefined);
    (runner as any).updateJobStatus = vi.fn(async () => undefined);

    const handle = { describe: vi.fn(async () => ({ id: 'exists' })) };
    client.schedule.getHandle.mockReturnValue(handle);

    const out = await runner.scheduleRecurringJob(
      'extension-scheduled-invocation',
      { tenantId: 'tenant-1' } as any,
      '0 1 * * *',
      { singletonKey: 'extsched:install-1:sched-2' }
    );

    expect(out.externalId).toBe('extsched:install-1:sched-2');
    expect(client.schedule.create).not.toHaveBeenCalled();
  });
});
